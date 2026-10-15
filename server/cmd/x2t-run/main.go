// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// x2t-run converts one document with the server build of x2t and says what
// it took (README.md "x2t on a server"):
//
//	x2t-run -wasm dist/x2t/x2t-server.wasm -in report.docx -to odt [-out report.odt]
//	        [-format-to N] [-codepage 46 -delim 2 | -delim-char ';'] [-password P]
//	        [-pdf pdf.bin -fonts DIR] [-thumb 320]
//	        [-repeat N] [-max-pages N] [-cache DIR] [-interp] [-timeout 2m]
//
// It prints one JSON line per conversion: the times (compile once,
// instantiate and run each time), the instance's memory at its largest,
// x2t's return code, the output's size and the process's resident memory at
// its largest (Linux).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime/pprof"
	"strings"
	"time"

	"github.com/BRF-Tech/filex-office-editor/server/internal/measure"
	"github.com/BRF-Tech/filex-office-editor/server/x2t"
)

func main() {
	wasm := flag.String("wasm", "dist/x2t/x2t-server.wasm", "the server build of x2t")
	in := flag.String("in", "", "the document")
	from := flag.String("from", "", "its format (default: its extension)")
	to := flag.String("to", "", "the target's extension")
	out := flag.String("out", "", "where the output goes (default: none)")
	formatTo := flag.Int("format-to", 0, "x2t's m_nFormatTo")
	codepage := flag.Int("codepage", 0, "txt/csv encoding (x2t's number, 46 = UTF-8)")
	delim := flag.Int("delim", 0, "csv delimiter: 1 tab, 2 ;, 3 :, 4 ,, 5 space")
	delimChar := flag.String("delim-char", "", "csv delimiter of one's own")
	password := flag.String("password", "", "a password-protected document's password")
	savePassword := flag.String("save-password", "", "protect the output with this password")
	pdf := flag.String("pdf", "", "the editor's drawing of the pages (pdf.bin), for a PDF")
	fontsDir := flag.String("fonts", "", "a directory of font files, for a PDF or an image")
	thumb := flag.Int("thumb", 0, "an image target as a thumbnail of the first page, fitted into N x N")
	repeat := flag.Int("repeat", 1, "how many conversions")
	maxPages := flag.Uint("max-pages", 0, "memory cap in 64 KiB pages")
	cache := flag.String("cache", "", "compilation cache directory")
	interp := flag.Bool("interp", false, "wazero's interpreter")
	noInterrupt := flag.Bool("no-interrupt", false, "compile without wazero's context watch (faster; -timeout no longer stops a conversion)")
	imports := flag.Bool("imports", false, "list the module's imports and exit")
	timeout := flag.Duration("timeout", 2*time.Minute, "a conversion that takes longer is stopped")
	cpuprofile := flag.String("cpuprofile", "", "write a Go CPU profile of the conversions here")
	flag.Parse()

	ctx := context.Background()
	b, err := os.ReadFile(*wasm)
	check(err)
	e, err := x2t.New(ctx, b, x2t.Options{MaxMemoryPages: uint32(*maxPages), CacheDir: *cache, Interpreter: *interp, NoInterrupt: *noInterrupt})
	check(err)
	defer e.Close(ctx)
	if *imports {
		for _, s := range e.Imports() {
			fmt.Println(s)
		}
		fmt.Fprintf(os.Stderr, "%d imports, %d answered as missing\n", len(e.Imports()), len(e.Missing))
		return
	}
	input, err := os.ReadFile(*in)
	check(err)
	j := x2t.Job{From: *from, To: *to, Input: input, FormatTo: *formatTo, Password: *password, SavePassword: *savePassword}
	if j.From == "" {
		j.From = strings.TrimPrefix(strings.ToLower(filepath.Ext(*in)), ".")
	}
	if *codepage > 0 || *delim > 0 || *delimChar != "" {
		j.Text = &x2t.TextOptions{Codepage: *codepage, Delimiter: *delim, DelimiterChar: *delimChar}
		if j.Text.Codepage == 0 {
			j.Text.Codepage = 46
		}
	}
	if *thumb > 0 {
		j.Thumbnail = &x2t.Thumbnail{Format: 4, Aspect: 1, First: true, Width: *thumb, Height: *thumb}
	}
	if *pdf != "" {
		j.PDF, err = os.ReadFile(*pdf)
		check(err)
	}
	if *fontsDir != "" {
		j.Fonts = map[string][]byte{}
		ents, err := os.ReadDir(*fontsDir)
		check(err)
		for _, ent := range ents {
			if ent.Type().IsRegular() {
				fb, err := os.ReadFile(filepath.Join(*fontsDir, ent.Name()))
				check(err)
				j.Fonts[ent.Name()] = fb
			}
		}
	}
	if *cpuprofile != "" {
		f, err := os.Create(*cpuprofile)
		check(err)
		check(pprof.StartCPUProfile(f))
		defer pprof.StopCPUProfile()
	}
	for i := 0; i < *repeat; i++ {
		t0 := time.Now()
		cctx, cancel := context.WithTimeout(ctx, *timeout)
		res, err := e.Convert(cctx, j)
		cancel()
		line := map[string]any{
			"in":          filepath.Base(*in),
			"to":          j.To,
			"in_bytes":    len(input),
			"compile_ms":  e.Compile.Milliseconds(),
			"total_ms":    time.Since(t0).Milliseconds(),
			"rss_peak_mb": measure.RSSPeakMB(),
		}
		if res != nil {
			line["instantiate_ms"] = res.Stats.Instantiate.Milliseconds()
			line["run_ms"] = res.Stats.Run.Milliseconds()
			line["peak_mb"] = float64(res.Stats.PeakBytes) / (1 << 20)
			line["exit"] = res.Stats.Exit
			line["out_bytes"] = len(res.Output)
			line["media"] = len(res.Media)
			if s := strings.TrimSpace(res.Stderr); s != "" {
				line["stderr"] = tail(s, 400)
			}
			if s := strings.TrimSpace(res.Stdout); s != "" {
				line["stdout"] = tail(s, 400)
			}
		}
		if err != nil {
			line["error"] = err.Error()
		}
		enc, _ := json.Marshal(line)
		fmt.Println(string(enc))
		if err == nil && *out != "" && i == 0 {
			check(os.WriteFile(*out, res.Output, 0o644))
		}
	}
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "..." + s[len(s)-n:]
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "x2t-run:", err)
		os.Exit(1)
	}
}
