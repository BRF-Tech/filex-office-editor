// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// office-convert turns an office document into a PDF or a thumbnail without
// a browser and without a Document Server, the way a Document Server does
// it (x2t, then doctrenderer, then x2t), all of it WebAssembly under wazero
// (docs/SERVER.md):
//
//  1. x2t-server.wasm: the document -> Editor.bin (and its images)
//
//  2. QuickJS (qjs-wasi.wasm) with sdkjs, server/layout/worker.js:
//     Editor.bin -> pdf.bin, the pages as drawing commands
//
//  3. x2t-server.wasm: Editor.bin + pdf.bin + the fonts -> PDF, or PNG
//
//     office-convert -x2t x2t-server.wasm -qjs qjs-wasi.wasm -engine DIR -in report.docx -to pdf [-out report.pdf]
//     office-convert ... -in report.docx -to png -thumb 320
//     [-repeat N] (the same document again, on the warm worker)
//
// DIR holds sdkjs/, fonts/ and layout/ (server/layout). It prints one JSON
// line per conversion with each stage's time.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BRF-Tech/filex-office-editor/server/internal/measure"
	"github.com/BRF-Tech/filex-office-editor/server/layout"
	"github.com/BRF-Tech/filex-office-editor/server/x2t"
)

// The editor's format, by kind (AVS_OFFICESTUDIO_FILE_CANVAS_*).
var canvas = map[string]int{"word": 0x2001, "cell": 0x2002, "slide": 0x2003}

// csvText is how a csv is read here: UTF-8, comma (filex sniffs the
// dialect and passes it; this command does not).
func csvText(ext string) *x2t.TextOptions {
	if ext != "csv" {
		return nil
	}
	return &x2t.TextOptions{Codepage: 46, Delimiter: 4}
}

// x2t's type numbers (AVS_OFFICESTUDIO_FILE_*), as src/formats.ts names them.
const (
	formatPDF  = 0x0201
	formatPNG  = 0x0405
	formatEPUB = 0x0048
	formatMD   = 0x005c
)

// The layout's job for each target.
var layoutMode = map[string]string{"pdf": "pdf", "png": "image", "html": "html", "md": "html", "epub": "html"}

func main() {
	x2tWasm := flag.String("x2t", "dist/x2t/x2t-server.wasm", "the server build of x2t")
	qjsWasm := flag.String("qjs", "", "QuickJS for WASI: quickjs-ng's qjs-wasi.wasm or layout-host.wasm (server/layout/host)")
	engine := flag.String("engine", "", "the engine directory (sdkjs/, fonts/, layout/)")
	in := flag.String("in", "", "the document")
	to := flag.String("to", "pdf", "pdf or png")
	thumb := flag.Int("thumb", 320, "for png: the first page fitted into N x N")
	out := flag.String("out", "", "where the result goes")
	repeat := flag.Int("repeat", 1, "conversions of the same document (the layout worker stays warm)")
	cache := flag.String("cache", "", "compilation cache directory")
	noInterrupt := flag.Bool("no-interrupt", false, "compile both modules without wazero's context watch (faster; nothing can stop a run but the process ending)")
	bytecode := flag.String("bytecode", "", "with -qjs layout-host.wasm: a directory to keep sdkjs as QuickJS bytecode in")
	params := flag.String("json", "", "the Document Server's m_sJsonParams (JSON), e.g. a spreadsheet's page layout")
	flag.Parse()

	ctx := context.Background()
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(*in)), ".")
	kind := layout.KindOf(ext)
	if kind == "" {
		fail(fmt.Errorf("%s: no editor opens it", *in))
	}
	if _, ok := layoutMode[*to]; !ok {
		fail(fmt.Errorf("-to %q: pdf, png, html, md or epub", *to))
	}
	var jsonParams any
	if *params != "" {
		fail(json.Unmarshal([]byte(*params), &jsonParams))
	}

	t0 := time.Now()
	xb, err := os.ReadFile(*x2tWasm)
	fail(err)
	conv, err := x2t.New(ctx, xb, x2t.Options{CacheDir: *cache, NoInterrupt: *noInterrupt})
	fail(err)
	defer conv.Close(ctx)
	qb, err := os.ReadFile(*qjsWasm)
	fail(err)
	lay, err := layout.New(ctx, qb, layout.Options{EngineDir: *engine, CacheDir: *cache, BytecodeDir: *bytecode, NoInterrupt: *noInterrupt})
	fail(err)
	defer lay.Close(ctx)
	compile := time.Since(t0)

	t1 := time.Now()
	w, err := lay.Start(ctx, kind)
	fail(err)
	defer w.Close(ctx)
	start := time.Since(t1)

	input, err := os.ReadFile(*in)
	fail(err)
	for i := 0; i < *repeat; i++ {
		line := map[string]any{"in": filepath.Base(*in), "to": *to, "kind": kind}
		if i == 0 {
			line["compile_ms"] = compile.Milliseconds()
			line["worker_start_ms"] = start.Milliseconds()
		}
		begin := time.Now()
		s := begin
		// The editor's format by its type, as a Document Server asks for it:
		// by the extension alone x2t refuses a doc, xls, ppt or csv (88).
		bin, err := conv.Convert(ctx, x2t.Job{From: ext, To: "bin", Input: input, FormatTo: canvas[kind], Text: csvText(ext)})
		line["to_bin_ms"] = time.Since(s).Milliseconds()
		if err != nil {
			report(line, err)
			continue
		}
		mode := layoutMode[*to]
		s = time.Now()
		lr, err := w.Layout(ctx, bin.Output, bin.Media, mode, jsonParams)
		line["layout_ms"] = time.Since(s).Milliseconds()
		if err != nil {
			report(line, err)
			continue
		}
		line["layout"] = lr.Ms
		line["font_engine_ms"] = lr.FontEngineMs
		line["pages"] = lr.Pages
		if *to == "html" {
			// The layout's HTML is the result, as doctrenderer's is.
			line["out_bytes"] = len(lr.PDFBin)
			line["total_ms"] = time.Since(begin).Milliseconds()
			if *out != "" && i == 0 {
				fail(os.WriteFile(*out, lr.PDFBin, 0o644))
			}
			report(line, nil)
			continue
		}
		if *to == "md" || *to == "epub" {
			// md: x2t's own html2md, from the layout's HTML; epub: x2t's
			// doct_bin2epub, which reads the HTML where doctrenderer would
			// have written it.
			j := x2t.Job{From: "html", To: "md", Input: lr.PDFBin, FormatTo: formatMD}
			if *to == "epub" {
				j = x2t.Job{From: "bin", To: "epub", Input: bin.Output, Media: bin.Media, HTML: lr.PDFBin, FormatTo: formatEPUB}
			}
			s = time.Now()
			res, err := conv.Convert(ctx, j)
			line["from_bin_ms"] = time.Since(s).Milliseconds()
			line["total_ms"] = time.Since(begin).Milliseconds()
			if err == nil {
				line["out_bytes"] = len(res.Output)
				if *out != "" && i == 0 {
					fail(os.WriteFile(*out, res.Output, 0o644))
				}
			}
			report(line, err)
			continue
		}
		j := x2t.Job{From: "bin", To: *to, Input: bin.Output, Media: bin.Media, PDF: lr.PDFBin, Fonts: lr.Fonts, FormatTo: formatPDF}
		if *to == "png" {
			j.FormatTo = formatPNG
			j.Thumbnail = &x2t.Thumbnail{Format: 4, Aspect: 1, First: true, Width: *thumb, Height: *thumb}
		}
		s = time.Now()
		res, err := conv.Convert(ctx, j)
		line["from_bin_ms"] = time.Since(s).Milliseconds()
		line["total_ms"] = time.Since(begin).Milliseconds()
		if err != nil {
			report(line, err)
			continue
		}
		line["out_bytes"] = len(res.Output)
		if *out != "" && i == 0 {
			fail(os.WriteFile(*out, res.Output, 0o644))
		}
		report(line, nil)
	}
}

func report(line map[string]any, err error) {
	if err != nil {
		line["error"] = err.Error()
	}
	line["rss_peak_mb"] = measure.RSSPeakMB()
	b, _ := json.Marshal(line)
	fmt.Println(string(b))
}

func fail(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "office-convert:", err)
		os.Exit(1)
	}
}
