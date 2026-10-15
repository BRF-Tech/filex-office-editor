// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package x2t

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

// The server build of x2t, made by `bash scripts/x2t/build.sh --server`
// (dist/x2t/x2t-server.wasm); the tests that run it skip without it.
func engine(t *testing.T) *Engine {
	t.Helper()
	path := os.Getenv("X2T_SERVER_WASM")
	if path == "" {
		path = "../../dist/x2t/x2t-server.wasm"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("no server build of x2t (%v): bash scripts/x2t/build.sh --server", err)
	}
	ctx := context.Background()
	e, err := New(ctx, b, Options{CacheDir: os.Getenv("X2T_CACHE")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Close(ctx) })
	return e
}

const tr = "Şifreli belge: Iğdır, İzmir ve Çanakkale - ğüşöçı"

func zipOf(t *testing.T, parts map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, body := range parts {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, body)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func docx(t *testing.T, text string) []byte {
	return zipOf(t, map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":         `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":   `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>` + text + `</w:t></w:r></w:p></w:body></w:document>`,
	})
}

func xlsx(t *testing.T, a1, b1 string) []byte {
	return zipOf(t, map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Şehirler" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
		"xl/worksheets/sheet1.xml":   `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>` + a1 + `</t></is></c><c r="B1" t="inlineStr"><is><t>` + b1 + `</t></is></c></row><row r="2"><c r="A2"><v>12.5</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>`,
	})
}

func part(t *testing.T, zipped []byte, name string) string {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(zipped), int64(len(zipped)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	for _, f := range z.File {
		if f.Name == name {
			r, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(r)
			return string(b)
		}
	}
	t.Fatalf("no %s in the package", name)
	return ""
}

func TestConvert_DocxToOdtAndBackKeepsTheTurkishText(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	odt, err := e.Convert(ctx, Job{From: "docx", To: "odt", Input: docx(t, tr)})
	if err != nil {
		t.Fatal(err)
	}
	if c := part(t, odt.Output, "content.xml"); !strings.Contains(c, tr) {
		t.Fatalf("odt's content.xml lacks the text:\n%.600s", c)
	}
	back, err := e.Convert(ctx, Job{From: "odt", To: "docx", Input: odt.Output})
	if err != nil {
		t.Fatal(err)
	}
	if d := part(t, back.Output, "word/document.xml"); !strings.Contains(d, tr) {
		t.Fatalf("docx's document.xml lacks the text:\n%.600s", d)
	}
	if odt.Stats.PeakBytes == 0 || odt.Stats.Run == 0 {
		t.Errorf("no measurement: %+v", odt.Stats)
	}
}

func TestConvert_DocxToEditorBinAndBack(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	bin, err := e.Convert(ctx, Job{From: "docx", To: "bin", Input: docx(t, tr)})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(bin.Output, []byte("DOCY;v")) {
		t.Fatalf("not an Editor.bin without base64: %q", bin.Output[:min(16, len(bin.Output))])
	}
	back, err := e.Convert(ctx, Job{From: "bin", To: "docx", Input: bin.Output, Media: bin.Media})
	if err != nil {
		t.Fatal(err)
	}
	if d := part(t, back.Output, "word/document.xml"); !strings.Contains(d, tr) {
		t.Fatalf("the text did not come back:\n%.600s", d)
	}
}

func TestConvert_XlsxToCsvWithTheDelimiterAsked(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	in := xlsx(t, "Şehir", "Sıcaklık")
	for _, c := range []struct {
		text *TextOptions
		sep  string
	}{
		{&TextOptions{Codepage: 46, Delimiter: 4}, ","},
		{&TextOptions{Codepage: 46, Delimiter: 2}, ";"},
		{&TextOptions{Codepage: 46, DelimiterChar: "|"}, "|"},
	} {
		res, err := e.Convert(ctx, Job{From: "xlsx", To: "csv", Input: in, Text: c.text})
		if err != nil {
			t.Fatal(err)
		}
		got := strings.TrimPrefix(string(res.Output), "\xef\xbb\xbf")
		if !strings.HasPrefix(got, "Şehir"+c.sep+"Sıcaklık") {
			t.Errorf("delimiter %q: %q", c.sep, got)
		}
	}
}

func TestConvert_ANewInstanceEachTimeSeesNothingOfTheLast(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	a, err := e.Convert(ctx, Job{From: "docx", To: "odt", Input: docx(t, "first")})
	if err != nil {
		t.Fatal(err)
	}
	b, err := e.Convert(ctx, Job{From: "docx", To: "odt", Input: docx(t, "second")})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(part(t, b.Output, "content.xml"), "first") || !strings.Contains(part(t, a.Output, "content.xml"), "first") {
		t.Fatal("one conversion saw the other's document")
	}
}

func TestConvert_NotADocumentIsAnErrorNotAPanic(t *testing.T) {
	e := engine(t)
	_, err := e.Convert(context.Background(), Job{From: "docx", To: "odt", Input: []byte("this is no office document")})
	var xe *Error
	var miss *MissingFunction
	if err == nil || !(errors.As(err, &xe) || errors.As(err, &miss) || strings.Contains(err.Error(), "x2t")) {
		t.Fatalf("got %v", err)
	}
}
