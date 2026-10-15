// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// Package x2t runs x2t, ONLYOFFICE's converter, on a server without a
// browser or a JavaScript engine: the server build of x2t
// (scripts/x2t/build.sh --server, x2t-server.wasm) is a WASI command, and
// wazero runs it, one module instance per conversion, with a directory of
// its own mounted at Dir.
//
// It is the measurement of filex task #268 (README.md "x2t on a server")
// and the reference a host - filex's engine for apps - follows.
package x2t

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

// Options tune an Engine.
type Options struct {
	// MaxMemoryPages caps every instance's memory, in 64 KiB pages (0: the
	// module's own maximum).
	MaxMemoryPages uint32
	// CacheDir keeps the compiled module between runs ("" compiles each time).
	CacheDir string
	// Interpreter runs the module in wazero's interpreter instead of compiling it.
	Interpreter bool
	// NoInterrupt compiles the module without wazero's context watch: every
	// call into it is cheaper (no goroutine per call), but a conversion can
	// no longer be stopped from outside - only by ending the process it runs
	// in (docs/SERVER.md, "How filex runs it").
	NoInterrupt bool
}

// Engine is a compiled x2t, ready to convert.
type Engine struct {
	rt      wazero.Runtime
	mod     wazero.CompiledModule
	Missing []string // the build's undefined functions (MissingFunction if reached)
	Compile time.Duration
}

// New compiles x2t-server.wasm.
func New(ctx context.Context, wasm []byte, o Options) (*Engine, error) {
	cfg := wazero.NewRuntimeConfigCompiler()
	if o.Interpreter {
		cfg = wazero.NewRuntimeConfigInterpreter()
	}
	cfg = cfg.WithCloseOnContextDone(!o.NoInterrupt)
	if o.MaxMemoryPages > 0 {
		cfg = cfg.WithMemoryLimitPages(o.MaxMemoryPages)
	}
	if o.CacheDir != "" {
		cache, err := wazero.NewCompilationCacheWithDir(o.CacheDir)
		if err != nil {
			return nil, err
		}
		cfg = cfg.WithCompilationCache(cache)
	}
	rt := wazero.NewRuntimeWithConfig(ctx, cfg)
	t0 := time.Now()
	mod, err := rt.CompileModule(ctx, wasm)
	if err != nil {
		rt.Close(ctx)
		return nil, err
	}
	e := &Engine{rt: rt, mod: mod, Compile: time.Since(t0)}
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, rt); err != nil {
		rt.Close(ctx)
		return nil, err
	}
	if e.Missing, err = Env(ctx, rt, mod); err != nil {
		rt.Close(ctx)
		return nil, err
	}
	return e, nil
}

// Close frees the runtime.
func (e *Engine) Close(ctx context.Context) error { return e.rt.Close(ctx) }

// Imports lists what the module imports, "module.name", for the record.
func (e *Engine) Imports() []string {
	var out []string
	for _, f := range e.mod.ImportedFunctions() {
		m, n, _ := f.Import()
		out = append(out, m+"."+n)
	}
	return out
}

// Stats are a conversion's measurements.
type Stats struct {
	Instantiate time.Duration // a new instance (memory, data segments)
	Run         time.Duration // x2t's main, the conversion itself
	PeakBytes   uint64        // the instance's memory at its largest
	Exit        uint32        // x2t's return code (0: converted)
}

// Result is a conversion's output.
type Result struct {
	Output []byte
	Media  map[string][]byte // the images of an Editor.bin, by name
	Stats  Stats
	Stdout string
	Stderr string
}

// Error is a conversion x2t refused or failed: its return code (x2t's
// AVS_FILEUTILS_ERROR_*, as a Document Server reports it) and what it wrote.
type Error struct {
	Code   uint32
	Stderr string
}

func (e *Error) Error() string { return fmt.Sprintf("x2t: conversion failed (%d)", e.Code) }

// Convert runs one conversion in a new instance.
func (e *Engine) Convert(ctx context.Context, j Job) (*Result, error) {
	if err := j.check(); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "x2t-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	for _, d := range []string{"media", "fonts", "themes", "tmp"} {
		if err := os.Mkdir(filepath.Join(dir, d), 0o700); err != nil {
			return nil, err
		}
	}
	files := map[string][]byte{"input." + j.From: j.Input, "params.xml": []byte(j.Params())}
	if j.PDF != nil {
		// Beside the document for a PDF (01-cryptpad-wasm.patch), in the
		// temporary directory for an image (doct_bin2image, as upstream).
		files["pdf.bin"] = j.PDF
		files[filepath.Join("tmp", "pdf.bin")] = j.PDF
	}
	for n, b := range j.Media {
		files[filepath.Join("media", n)] = b
	}
	for n, b := range j.Fonts {
		files[filepath.Join("fonts", n)] = b
	}
	for n, b := range files {
		if err := os.WriteFile(filepath.Join(dir, n), b, 0o600); err != nil {
			return nil, err
		}
	}

	var stdout, stderr bytes.Buffer
	cfg := wazero.NewModuleConfig().
		WithName("").
		WithArgs("x2t", Dir+"/params.xml").
		WithEnv("TMPDIR", Dir+"/tmp").
		WithFSConfig(wazero.NewFSConfig().WithDirMount(dir, Dir)).
		WithStdout(&stdout).WithStderr(&stderr).
		WithSysWalltime().WithSysNanotime().
		WithStartFunctions() // _start is called below, to time it apart
	res := &Result{}
	ctx = WithCallCache(ctx)

	t0 := time.Now()
	inst, err := e.rt.InstantiateModule(ctx, e.mod, cfg)
	if err != nil {
		return nil, err
	}
	defer inst.Close(ctx)
	res.Stats.Instantiate = time.Since(t0)
	start := inst.ExportedFunction("_start")
	if start == nil {
		return nil, errors.New("x2t: the module has no _start (not the server build)")
	}
	t1 := time.Now()
	_, err = start.Call(ctx)
	res.Stats.Run = time.Since(t1)
	// A memory only grows: its size after the run is its largest (the
	// buffer outlives x2t's exit, which closes the instance).
	if m := inst.Memory(); m != nil {
		res.Stats.PeakBytes = uint64(m.Size())
	}
	res.Stdout, res.Stderr = stdout.String(), stderr.String()
	var exit *sys.ExitError
	switch {
	case err == nil:
	case errors.As(err, &exit):
		res.Stats.Exit = exit.ExitCode()
	default:
		var miss *MissingFunction
		if errors.As(err, &miss) {
			return res, miss
		}
		return res, fmt.Errorf("x2t stopped: %w", err)
	}
	if res.Stats.Exit != 0 {
		return res, &Error{Code: res.Stats.Exit, Stderr: res.Stderr}
	}
	out, err := os.ReadFile(filepath.Join(dir, "output."+j.To))
	if err != nil || len(out) == 0 {
		return res, errors.New("x2t: no output")
	}
	res.Output = out
	if j.To == "bin" {
		res.Media = map[string][]byte{}
		ents, _ := os.ReadDir(filepath.Join(dir, "media"))
		for _, ent := range ents {
			if b, err := os.ReadFile(filepath.Join(dir, "media", ent.Name())); err == nil {
				res.Media[ent.Name()] = b
			}
		}
	}
	return res, nil
}
