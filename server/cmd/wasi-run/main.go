// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// wasi-run runs a WASI command with wazero and says what it took - the
// measurement tool of the layout spike (docs/SERVER.md, "Page layout
// without a browser"), where it runs a JavaScript engine compiled to
// WebAssembly (QuickJS) with ONLYOFFICE's sdkjs:
//
//	wasi-run -wasm qjs-wasi.wasm -mount /path/to/spike:/s -- qjs /s/run.js
//
// It prints the program's own output, then one JSON line on stderr: the
// compile, instantiate and run times, the instance's memory at its largest,
// the exit code and the process's resident memory at its largest (Linux).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/BRF-Tech/filex-office-editor/server/internal/measure"
	"github.com/BRF-Tech/filex-office-editor/server/x2t"
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

type mounts []string

func (m *mounts) String() string     { return strings.Join(*m, ",") }
func (m *mounts) Set(s string) error { *m = append(*m, s); return nil }

func main() {
	wasm := flag.String("wasm", "", "the WASI command")
	cache := flag.String("cache", "", "compilation cache directory")
	maxPages := flag.Uint("max-pages", 0, "memory cap in 64 KiB pages")
	var ms, envs mounts
	flag.Var(&ms, "mount", "host:guest directory (repeatable)")
	flag.Var(&envs, "env", "KEY=value in the program's environment (repeatable)")
	flag.Parse()

	ctx := context.Background()
	b, err := os.ReadFile(*wasm)
	check(err)
	cfg := wazero.NewRuntimeConfigCompiler()
	if *maxPages > 0 {
		cfg = cfg.WithMemoryLimitPages(uint32(*maxPages))
	}
	if *cache != "" {
		c, err := wazero.NewCompilationCacheWithDir(*cache)
		check(err)
		cfg = cfg.WithCompilationCache(c)
	}
	rt := wazero.NewRuntimeWithConfig(ctx, cfg)
	defer rt.Close(ctx)
	wasi_snapshot_preview1.MustInstantiate(ctx, rt)
	t0 := time.Now()
	mod, err := rt.CompileModule(ctx, b)
	check(err)
	compile := time.Since(t0)
	for _, f := range mod.ImportedFunctions() {
		if m, _, _ := f.Import(); m == "env" {
			_, err := x2t.Env(ctx, rt, mod) // an emscripten build: invoke_*, longjmp
			check(err)
			break
		}
	}

	fsc := wazero.NewFSConfig()
	for _, m := range ms {
		host, guest, ok := strings.Cut(m, ":")
		if !ok {
			check(fmt.Errorf("-mount %q: host:guest", m))
		}
		fsc = fsc.WithDirMount(host, guest)
	}
	mc := wazero.NewModuleConfig().WithName("").WithArgs(flag.Args()...).
		WithFSConfig(fsc).WithStdout(os.Stdout).WithStderr(os.Stderr).WithStdin(os.Stdin).
		WithSysWalltime().WithSysNanotime().WithSysNanosleep().WithStartFunctions()
	for _, kv := range envs {
		k, v, _ := strings.Cut(kv, "=")
		mc = mc.WithEnv(k, v)
	}
	t1 := time.Now()
	inst, err := rt.InstantiateModule(ctx, mod, mc)
	check(err)
	inst0 := time.Since(t1)
	t2 := time.Now()
	_, err = inst.ExportedFunction("_start").Call(x2t.WithCallCache(ctx))
	run := time.Since(t2)
	line := map[string]any{
		"compile_ms":     compile.Milliseconds(),
		"instantiate_ms": inst0.Milliseconds(),
		"run_ms":         run.Milliseconds(),
		"peak_mb":        float64(inst.Memory().Size()) / (1 << 20),
		"rss_peak_mb":    measure.RSSPeakMB(),
	}
	var exit *sys.ExitError
	switch {
	case err == nil:
		line["exit"] = 0
	case errors.As(err, &exit):
		line["exit"] = exit.ExitCode()
	default:
		line["error"] = err.Error()
	}
	enc, _ := json.Marshal(line)
	fmt.Fprintln(os.Stderr, string(enc))
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "wasi-run:", err)
		os.Exit(1)
	}
}
