// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package layout

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

// The layout runs need QuickJS for WASI (LAYOUT_QJS: quickjs-ng's
// qjs-wasi.wasm), an engine directory (LAYOUT_ENGINE: sdkjs/ and fonts/
// from the bundle, layout/ with worker.js, fonts_ie.js and
// xregexp-all-min.js) and an Editor.bin of a Word document (LAYOUT_DOCX_BIN,
// what x2t makes of a docx); docs/SERVER.md says where each comes from.
func worker(t *testing.T, kind string) (*Engine, *Worker) {
	t.Helper()
	qjs, dir := os.Getenv("LAYOUT_QJS"), os.Getenv("LAYOUT_ENGINE")
	if qjs == "" || dir == "" {
		t.Skip("LAYOUT_QJS and LAYOUT_ENGINE are not set (docs/SERVER.md)")
	}
	b, err := os.ReadFile(qjs)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	e, err := New(ctx, b, Options{EngineDir: dir, CacheDir: os.Getenv("LAYOUT_CACHE")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Close(ctx) })
	w, err := e.Start(ctx, kind)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { w.Close(ctx) })
	return e, w
}

func editorBin(t *testing.T) []byte {
	t.Helper()
	p := os.Getenv("LAYOUT_DOCX_BIN")
	if p == "" {
		t.Skip("LAYOUT_DOCX_BIN is not set")
	}
	b, err := os.ReadFile(filepath.Clean(p))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestLayout_AWordDocumentBecomesPagesAndTheirFonts(t *testing.T) {
	_, w := worker(t, "word")
	bin := editorBin(t)
	r, err := w.Layout(context.Background(), bin, nil, "pdf", nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Pages < 1 || len(r.PDFBin) == 0 || len(r.Fonts) == 0 {
		t.Fatalf("pages %d, %d bytes, %d fonts", r.Pages, len(r.PDFBin), len(r.Fonts))
	}
	for name, f := range r.Fonts {
		// A plain font, its obfuscation undone: TrueType, OpenType or a collection.
		if !(bytes.HasPrefix(f, []byte{0, 1, 0, 0}) || bytes.HasPrefix(f, []byte("OTTO")) || bytes.HasPrefix(f, []byte("true")) || bytes.HasPrefix(f, []byte("ttcf"))) {
			t.Errorf("%s is not a plain font: % x", name, f[:min(4, len(f))])
		}
	}
}

func TestLayout_AWarmWorkerGivesTheSameDrawingAgain(t *testing.T) {
	_, w := worker(t, "word")
	bin := editorBin(t)
	ctx := context.Background()
	a, err := w.Layout(ctx, bin, nil, "pdf", nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := w.Layout(ctx, bin, nil, "pdf", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a.PDFBin, b.PDFBin) {
		t.Fatalf("the second layout differs: %d and %d bytes", len(a.PDFBin), len(b.PDFBin))
	}
}

func TestLayout_RefusesWhatIsNotAJob(t *testing.T) {
	if KindOf("docx") != "word" || KindOf("xlsx") != "cell" || KindOf("pptx") != "slide" || KindOf("pdf") != "" {
		t.Fatal("KindOf")
	}
	w := &Worker{}
	if _, err := w.Layout(context.Background(), nil, nil, "html", nil); err == nil {
		t.Fatal("mode html accepted")
	}
	if _, err := (&Engine{}).Start(context.Background(), "visio"); err == nil {
		t.Fatal("kind visio accepted")
	}
}
