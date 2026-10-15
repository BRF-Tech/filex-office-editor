// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// Package layout lays an editor document (Editor.bin, what x2t makes of a
// docx, xlsx or pptx) out into pages without a browser: sdkjs, the editor's
// own JavaScript, in QuickJS compiled to WebAssembly (quickjs-ng's
// qjs-wasi.wasm), under wazero. worker.js plays the Document Server's
// doctrenderer; the result is the pdf.bin x2t turns into a PDF or a
// thumbnail (docs/SERVER.md "Page layout without a browser").
//
// A Worker is one warm QuickJS instance with one editor's scripts loaded
// (word, cell or slide): loading them is most of the cost, so a worker
// takes job after job.
package layout

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

// Options tune an Engine.
type Options struct {
	// EngineDir holds sdkjs/ and fonts/ as the app's bundle has them, and
	// layout/ (worker.js, fonts_ie.js, xregexp-all-min.js). It is mounted
	// read-only.
	EngineDir string
	// MaxMemoryPages caps a worker's memory, in 64 KiB pages (0: no cap).
	MaxMemoryPages uint32
	// CacheDir keeps the compiled QuickJS between runs.
	CacheDir string
	// BytecodeDir, with layout-host.wasm, keeps sdkjs as QuickJS bytecode,
	// compiled by the first worker that needs it: a worker then starts
	// without parsing it (docs/SERVER.md). Mounted writable.
	BytecodeDir string
}

// Engine is a compiled QuickJS.
type Engine struct {
	rt   wazero.Runtime
	mod  wazero.CompiledModule
	o    Options
	host bool // layout-host.wasm, not quickjs-ng's qjs
}

// New compiles the JavaScript engine: quickjs-ng's qjs-wasi.wasm, or
// layout-host.wasm (server/layout/host), which can keep sdkjs as bytecode.
func New(ctx context.Context, qjs []byte, o Options) (*Engine, error) {
	if o.EngineDir == "" {
		return nil, errors.New("layout: no engine directory")
	}
	cfg := wazero.NewRuntimeConfigCompiler().WithCloseOnContextDone(true)
	if o.MaxMemoryPages > 0 {
		cfg = cfg.WithMemoryLimitPages(o.MaxMemoryPages)
	}
	if o.CacheDir != "" {
		c, err := wazero.NewCompilationCacheWithDir(o.CacheDir)
		if err != nil {
			return nil, err
		}
		cfg = cfg.WithCompilationCache(c)
	}
	rt := wazero.NewRuntimeWithConfig(ctx, cfg)
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, rt); err != nil {
		rt.Close(ctx)
		return nil, err
	}
	mod, err := rt.CompileModule(ctx, qjs)
	if err != nil {
		rt.Close(ctx)
		return nil, err
	}
	_, host := mod.ExportedFunctions()["_start"]
	host = host && isLayoutHost(qjs)
	return &Engine{rt: rt, mod: mod, o: o, host: host}, nil
}

// Close ends every worker and frees the runtime.
func (e *Engine) Close(ctx context.Context) error { return e.rt.Close(ctx) }

var kinds = map[string]bool{"word": true, "cell": true, "slide": true}

// args is the command line: quickjs-ng's qjs wants --std before the
// script, layout-host.wasm (it exports compileScript's helpers) the script
// first.
func (e *Engine) args(kind string) []string {
	if e.host {
		return []string{"layout-host", "/e/layout/worker.js", "/e", kind}
	}
	return []string{"qjs", "--std", "/e/layout/worker.js", "/e", kind}
}

func (e *Engine) cacheGuest() string {
	if e.o.BytecodeDir == "" {
		return ""
	}
	return "/c"
}

// Worker is a warm instance for one kind of document.
type Worker struct {
	Kind   string
	LoadMs int64

	mu   sync.Mutex
	in   *io.PipeWriter
	out  *bufio.Reader
	dir  string // the jobs directory, mounted at /j
	n    int
	done chan error
	inst interface{ Close(context.Context) error }
}

// Start loads one kind's scripts into a new instance and waits until it
// says it is ready.
func (e *Engine) Start(ctx context.Context, kind string) (*Worker, error) {
	if !kinds[kind] {
		return nil, fmt.Errorf("layout: no editor %q", kind)
	}
	dir, err := os.MkdirTemp("", "layout-")
	if err != nil {
		return nil, err
	}
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	fsc := wazero.NewFSConfig().WithReadOnlyDirMount(e.o.EngineDir, "/e").WithDirMount(dir, "/j")
	if e.o.BytecodeDir != "" {
		fsc = fsc.WithDirMount(e.o.BytecodeDir, "/c")
	}
	cfg := wazero.NewModuleConfig().WithName("").
		// qjs takes --std; layout-host.wasm makes std and os global itself
		// and takes the script first.
		WithArgs(e.args(kind)...).
		WithEnv("LAYOUT_CACHE", e.cacheGuest()).
		WithFSConfig(fsc).
		WithStdin(inR).WithStdout(outW).WithStderr(io.Discard).
		WithSysWalltime().WithSysNanotime().WithStartFunctions()
	inst, err := e.rt.InstantiateModule(ctx, e.mod, cfg)
	if err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	w := &Worker{Kind: kind, in: inW, out: bufio.NewReaderSize(outR, 1<<16), dir: dir, done: make(chan error, 1), inst: inst}
	go func() {
		_, err := inst.ExportedFunction("_start").Call(ctx)
		outW.CloseWithError(fmt.Errorf("layout: the worker ended: %v", err))
		w.done <- err
	}()
	var ready struct {
		Ready  bool   `json:"ready"`
		LoadMs int64  `json:"load_ms"`
		Error  string `json:"error"`
	}
	if err := w.read(&ready); err != nil {
		w.Close(ctx)
		return nil, err
	}
	if !ready.Ready {
		w.Close(ctx)
		return nil, fmt.Errorf("layout: the %s scripts did not load: %s", kind, ready.Error)
	}
	w.LoadMs = ready.LoadMs
	return w, nil
}

func (w *Worker) read(v any) error {
	line, err := w.out.ReadBytes('\n')
	if err != nil {
		return err
	}
	return json.Unmarshal(line, v)
}

// Result is a laid-out document.
type Result struct {
	PDFBin []byte            // the pages as drawing commands (x2t's pdf.bin)
	Fonts  map[string][]byte // the fonts they were drawn with, "<id>.ttf"
	Pages  int
	Ms     map[string]int64 // open, calculate, save
	// FontEngineMs is the time spent in FreeType and HarfBuzz (asm.js here).
	FontEngineMs int64
	Wall         time.Duration
}

var mediaName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// Layout lays out one Editor.bin, with its images (by name, without
// "media/"), for a PDF ("pdf") or a picture of its pages ("image"). json is
// the Document Server's m_sJsonParams (a spreadsheet's page layout,
// printPages...) or nil.
func (w *Worker) Layout(ctx context.Context, editorBin []byte, media map[string][]byte, mode string, params any) (*Result, error) {
	if mode != "pdf" && mode != "image" {
		return nil, fmt.Errorf("layout: mode %q", mode)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.n++
	name := strconv.Itoa(w.n)
	job := filepath.Join(w.dir, name)
	defer os.RemoveAll(job)
	for _, d := range []string{"", "media", "fonts"} {
		if err := os.MkdirAll(filepath.Join(job, d), 0o700); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(filepath.Join(job, "Editor.bin"), editorBin, 0o600); err != nil {
		return nil, err
	}
	for n, b := range media {
		if !mediaName.MatchString(n) {
			return nil, fmt.Errorf("layout: bad media name %q", n)
		}
		if err := os.WriteFile(filepath.Join(job, "media", n), b, 0o600); err != nil {
			return nil, err
		}
	}
	req, _ := json.Marshal(map[string]any{
		"in": "/j/" + name + "/Editor.bin", "out": "/j/" + name + "/pdf.bin",
		"fonts": "/j/" + name + "/fonts", "mode": mode, "json": params,
	})
	t0 := time.Now()
	if _, err := w.in.Write(append(req, '\n')); err != nil {
		return nil, err
	}
	var ans struct {
		OK         bool             `json:"ok"`
		Stage      string           `json:"stage"`
		Error      string           `json:"error"`
		Pages      int              `json:"pages"`
		Ms         map[string]int64 `json:"ms"`
		FontEngine struct {
			Ms int64 `json:"ms"`
		} `json:"font_engine"`
	}
	type readResult struct{ err error }
	got := make(chan readResult, 1)
	go func() { got <- readResult{w.read(&ans)} }()
	select {
	case r := <-got:
		if r.err != nil {
			return nil, r.err
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if !ans.OK {
		return nil, fmt.Errorf("layout: %s: %s", ans.Stage, ans.Error)
	}
	res := &Result{Pages: ans.Pages, Ms: ans.Ms, FontEngineMs: ans.FontEngine.Ms, Wall: time.Since(t0), Fonts: map[string][]byte{}}
	var err error
	if res.PDFBin, err = os.ReadFile(filepath.Join(job, "pdf.bin")); err != nil {
		return nil, err
	}
	ents, _ := os.ReadDir(filepath.Join(job, "fonts"))
	for _, ent := range ents {
		if b, err := os.ReadFile(filepath.Join(job, "fonts", ent.Name())); err == nil {
			res.Fonts[ent.Name()] = b
		}
	}
	return res, nil
}

// Close ends the worker.
func (w *Worker) Close(ctx context.Context) error {
	w.in.Close()
	err := w.inst.Close(ctx)
	os.RemoveAll(w.dir)
	return err
}

// KindOf is the editor a document of this extension opens in (the
// Document Server's documentType), "" for none.
func KindOf(ext string) string {
	switch ext {
	case "doc", "docx", "docm", "dot", "dotx", "dotm", "odt", "ott", "fodt", "rtf", "txt", "wps", "wpt", "stw", "sxw", "htm", "html", "mht", "mhtml", "xml", "epub", "fb2":
		return "word"
	case "xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "ods", "ots", "fods", "csv", "et", "ett", "sxc":
		return "cell"
	case "ppt", "pptx", "pptm", "pps", "ppsx", "ppsm", "pot", "potx", "potm", "odp", "otp", "fodp", "dps", "dpt", "sxi":
		return "slide"
	}
	return ""
}

// isLayoutHost tells layout-host.wasm from quickjs-ng's qjs by the names it
// carries (its two functions are registered by name).
func isLayoutHost(wasm []byte) bool {
	return bytes.Contains(wasm, []byte("compileScript")) && bytes.Contains(wasm, []byte("runBytecode"))
}
