// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package x2t

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/emscripten"
	"github.com/tetratelabs/wazero/sys"
)

// The server build of x2t (scripts/x2t/steps.sh, x2t_server) is a WASI
// command: its files, clock and exit go through WASI, which wazero gives it
// (the file calls through scripts/x2t/server/wasi-fs.c). What emscripten
// still imports from "env" is answered here the way emscripten's own
// JavaScript answers it in the browser - no JavaScript runs:
//
//   - invoke_<sig> and _emscripten_throw_longjmp: setjmp/longjmp (libpng,
//     libjpeg, FreeType). emscripten's JavaScript calls the table entry in a
//     try, and a longjmp is a throw it catches, restoring the stack and
//     calling setThrew. Here the longjmp is a Go panic the invoke catches.
//     The call itself is the module's fx_dyncall_<sig>
//     (scripts/x2t/server/dyncalls.py): with
//     -sEMULATE_FUNCTION_POINTER_CASTS a call from the host by the import's
//     signature traps, one made inside the module does not. A module
//     without them gets wazero's emscripten invoke.
//   - emscripten_notify_memory_growth: nothing to do.
//   - anything else: a function the link left undefined (x2t's build lists
//     them, README.md "x2t, the converter"). Reaching one stops the
//     conversion with "missing function: <name>", as the browser's
//     "Aborted(missing function: ...)" does.

// MissingFunction is the error of a conversion that reached a function the
// build does not have.
type MissingFunction struct{ Name string }

func (m *MissingFunction) Error() string { return "missing function: " + m.Name }

// errLongjmp is what _emscripten_throw_longjmp panics with.
var errLongjmp = errors.New("x2t: longjmp")

// Env instantiates the "env" module a module built by emscripten imports
// from. It returns the names it answers with a stand-in that stops the
// run (the build's undefined functions), sorted, for the record.
func Env(ctx context.Context, rt wazero.Runtime, guest wazero.CompiledModule) ([]string, error) {
	b := rt.NewHostModuleBuilder("env")
	exports := guest.ExportedFunctions()
	own := false
	for name := range exports {
		if strings.HasPrefix(name, "fx_dyncall_") {
			own = true
			break
		}
	}
	if _, ok := exports["fx_unwind"]; own && !ok {
		return nil, errors.New("x2t: the module has fx_dyncall_* without fx_unwind (rebuild it with scripts/x2t/build.sh --server)")
	}
	if !own {
		exp, err := emscripten.NewFunctionExporterForModule(guest)
		if err != nil {
			return nil, err
		}
		exp.ExportFunctions(b)
	}
	var missing []string
	next := firstDyncallSlot
	for _, fn := range guest.ImportedFunctions() {
		module, name, ok := fn.Import()
		if !ok || module != "env" {
			continue
		}
		var impl api.GoModuleFunc
		switch {
		case strings.HasPrefix(name, "invoke_") || name == "_emscripten_throw_longjmp" || name == "emscripten_notify_memory_growth":
			if !own {
				continue // wazero's emscripten package answers them
			}
			switch {
			case name == "_emscripten_throw_longjmp":
				impl = func(context.Context, api.Module, []uint64) { panic(errLongjmp) }
			case name == "emscripten_notify_memory_growth":
				impl = func(context.Context, api.Module, []uint64) {}
			default:
				dyn := "fx_dyncall_" + strings.TrimPrefix(name, "invoke_")
				if _, ok := exports[dyn]; !ok {
					return nil, fmt.Errorf("x2t: the module imports %s and does not export %s", name, dyn)
				}
				impl = invoke(slot{idx: next, name: dyn}, len(fn.ResultTypes()))
				next++
			}
		default:
			missing = append(missing, name)
			n := name
			impl = func(context.Context, api.Module, []uint64) { panic(&MissingFunction{Name: n}) }
		}
		b.NewFunctionBuilder().WithGoModuleFunction(impl, fn.ParamTypes(), fn.ResultTypes()).Export(name)
	}
	if _, err := b.Instantiate(ctx); err != nil {
		return nil, err
	}
	sort.Strings(missing)
	return missing, nil
}

// invoke is invoke_<sig>, emscripten's JavaScript
//
//	function invoke_vii(index, a1, a2) {
//	  var sp = stackSave();
//	  try { getWasmTableEntry(index)(a1, a2); }
//	  catch (e) { stackRestore(sp); if (e !== e+0) throw e; _setThrew(1, 0); }
//	}
//
// with the module's fx_dyncall_vii(index, a1, a2) for the table call. The
// stack pointer is kept by fx_dyncall_* itself, in the module, and put back
// by fx_unwind after a longjmp: saving it from here would be one more call
// into the module per invoke, and each call costs wazero a goroutine that
// watches the context (WithCloseOnContextDone) - x2t goes through invoke_*
// millions of times in a document with pictures.
func invoke(dynCall slot, nResults int) api.GoModuleFunc {
	return func(ctx context.Context, mod api.Module, stack []uint64) {
		err := exported(ctx, mod, dynCall).CallWithStack(ctx, stack)
		if err == nil {
			return
		}
		var exit *sys.ExitError
		if errors.As(err, &exit) || !errors.Is(err, errLongjmp) {
			panic(err)
		}
		var st [2]uint64
		mustCall(ctx, mod, slotUnwind, st[:])
		st[0], st[1] = 1, 0
		mustCall(ctx, mod, slotSetThrew, st[:])
		for i := 0; i < nResults; i++ {
			stack[i] = 0
		}
	}
}

func mustCall(ctx context.Context, mod api.Module, s slot, stack []uint64) {
	if err := exported(ctx, mod, s).CallWithStack(ctx, stack); err != nil {
		panic(err)
	}
}

// A function invoke_* or its longjmp path calls in the module, by its place
// in an instance's callCache: the two of the longjmp path first, then each
// fx_dyncall_<sig> in the order Env met its invoke_<sig>.
type slot struct {
	idx  int
	name string
}

var (
	slotUnwind   = slot{idx: 0, name: "fx_unwind"}
	slotSetThrew = slot{idx: 1, name: "setThrew"}
)

const firstDyncallSlot = 2

// The functions invoke_* calls, looked up once per instance: wazero makes
// a new callable (with its own stack) at every ExportedFunction, and x2t
// goes through invoke_* millions of times - measured, sample.docx to odt
// took 62.7 s with a lookup per call, of it a third in that allocation.
// They are kept by slot, not by name: Bug61268.doc (509 pictures, EMF ones
// turned into SVG) spent about a tenth of its 41 s conversion hashing the
// names for a map (CPU profile, 2026-10-16).
type callCache struct{ fns []api.Function }

type callCacheKey struct{}

// WithCallCache gives one instance's run a cache of the functions invoke_*
// calls; Convert does it for every conversion.
func WithCallCache(ctx context.Context) context.Context {
	return context.WithValue(ctx, callCacheKey{}, &callCache{fns: make([]api.Function, 16)})
}

func exported(ctx context.Context, mod api.Module, s slot) api.Function {
	c, _ := ctx.Value(callCacheKey{}).(*callCache)
	if c != nil && s.idx < len(c.fns) {
		if f := c.fns[s.idx]; f != nil {
			return f
		}
	}
	f := mod.ExportedFunction(s.name)
	if f == nil {
		panic(fmt.Errorf("x2t: the module does not export %s", s.name))
	}
	if c != nil {
		for s.idx >= len(c.fns) {
			c.fns = append(c.fns, nil)
		}
		c.fns[s.idx] = f
	}
	return f
}
