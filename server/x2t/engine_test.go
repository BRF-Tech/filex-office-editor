// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package x2t

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
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

// xlsx is a workbook of one sheet with its two strings in sharedStrings.xml,
// as Excel and LibreOffice write them. Not as inline strings: x2t's direct
// xlsx -> csv writes every inline string of a row as the row's first one
// ("abc,abc" for A1 "abc", B1 "xyz") - ONLYOFFICE's own x2t in the pinned
// Document Server image (9.4.0.129) does the same, measured 2026-10-16, so
// it is upstream's and not this build's; through the editor's format
// (xlsx -> Editor.bin -> csv, what the page does) the cells come out whole.
func xlsx(t *testing.T, a1, b1 string) []byte {
	return zipOf(t, map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Şehirler" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
		"xl/sharedStrings.xml":       `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>` + a1 + `</t></si><si><t>` + b1 + `</t></si></sst>`,
		"xl/worksheets/sheet1.xml":   `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>12.5</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>`,
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

// A document saved with a password is encrypted with a salt and an
// initialisation vector x2t draws from /dev/urandom - WASI's random_get,
// which wazero answers from the module configuration's random source. Its
// default is deterministic: before internal/wasmsys every protected odt
// had the same IV and salt, every protected docx the same saltValue
// (measured, 2026-10-16). Two saves of one document must differ in both.
func TestConvert_EachPasswordProtectedSaveHasItsOwnSaltAndIV(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	salts := func(b []byte, re *regexp.Regexp) string {
		var out []string
		for _, m := range re.FindAllSubmatch(b, -1) {
			out = append(out, string(m[1]))
		}
		if len(out) == 0 {
			t.Fatalf("no salt or IV in the protected file (%d bytes)", len(b))
		}
		return strings.Join(out, " ")
	}
	odtRe := regexp.MustCompile(`(?:initialisation-vector|salt)="([^"]+)"`)
	docxRe := regexp.MustCompile(`saltValue="([^"]+)"`)
	plain, err := e.Convert(ctx, Job{From: "docx", To: "odt", Input: docx(t, tr)})
	if err != nil {
		t.Fatal(err)
	}
	var odt, ooxml [2]string
	for i := range 2 {
		o, err := e.Convert(ctx, Job{From: "docx", To: "odt", Input: docx(t, tr), SavePassword: "Gizli-123"})
		if err != nil {
			t.Fatal(err)
		}
		odt[i] = salts([]byte(part(t, o.Output, "META-INF/manifest.xml")), odtRe)
		d, err := e.Convert(ctx, Job{From: "odt", To: "docx", Input: plain.Output, SavePassword: "Gizli-123"})
		if err != nil {
			t.Fatal(err)
		}
		ooxml[i] = salts(d.Output, docxRe)
	}
	if odt[0] == odt[1] {
		t.Errorf("two protected odts have the same IV and salt: %s", odt[0])
	}
	if ooxml[0] == ooxml[1] {
		t.Errorf("two protected docx files have the same salts: %s", ooxml[0])
	}
}

// emf is a 132-byte EMF picture: its header (100 x 70 device units), one
// rectangle, the end of the file (the same as the app's tests/fixtures/office.ts).
func emf() []byte {
	var b bytes.Buffer
	w := func(v ...any) {
		for _, x := range v {
			binary.Write(&b, binary.LittleEndian, x)
		}
	}
	w(uint32(1), uint32(88), int32(0), int32(0), int32(100), int32(70), int32(0), int32(0), int32(2646), int32(1852))
	w(uint32(0x464d4520), uint32(0x10000), uint32(132), uint32(3), uint16(1), uint16(0), uint32(0), uint32(0), uint32(0))
	w(int32(1024), int32(768), int32(270), int32(203))
	w(uint32(43), uint32(24), int32(10), int32(10), int32(90), int32(60))
	w(uint32(14), uint32(20), uint32(0), uint32(16), uint32(20))
	return b.Bytes()
}

func docxWithEMF(t *testing.T) []byte {
	const size = `cx="952500" cy="666750"`
	return zipOf(t, map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="emf" ContentType="image/x-emf"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.emf"/></Relationships>`,
		"word/media/image1.emf":        string(emf()),
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>` +
			`<w:p><w:r><w:t>` + tr + `</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent ` + size + `/><wp:docPr id="1" name="Resim 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
			`<pic:nvPicPr><pic:cNvPr id="1" name="image1.emf"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
			`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ` + size + `/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`,
	})
}

// docs/PARITY.md A14: before x2t v9.4.0.129+3 every metafile x2t opened
// wrote past its block (the SVG engine ran HtmlFile2's CSS calculator, built
// for another layout: scripts/x2t/patches/06-svg-css-namespace.patch), and a
// docx with one EMF picture stopped the module. Red on +2.
func TestConvert_ADocxWithAnEMFPictureComesInWithItAsSVG(t *testing.T) {
	e := engine(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	in := docxWithEMF(t)
	for i := 0; i < 3; i++ {
		bin, err := e.Convert(ctx, Job{From: "docx", To: "bin", Input: in})
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		if !bytes.HasPrefix(bin.Output, []byte("DOCY;v")) {
			t.Fatalf("not an Editor.bin: %q", bin.Output[:min(16, len(bin.Output))])
		}
		var svg, emfOut bool
		for name, b := range bin.Media {
			svg = svg || (strings.HasSuffix(name, ".svg") && bytes.Contains(b, []byte("<svg")))
			emfOut = emfOut || strings.HasSuffix(name, ".emf")
		}
		if !svg || !emfOut {
			t.Fatalf("run %d: the picture is not there as EMF and SVG: %d media", i, len(bin.Media))
		}
	}
}

// HTML to md looped (the server build) or stopped (the page's) on any HTML
// before x2t v9.4.0.129+3, for the same reason (patches/06): the context
// ends the loop, and the test fails rather than hangs.
func TestConvert_HTMLToMarkdown(t *testing.T) {
	e := engine(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	html := `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /></head><body><p><b>` + tr + `</b></p><table><tr><td>Şehir</td><td>Sıcaklık</td></tr><tr><td>İstanbul</td><td>Iğdır</td></tr></table></body></html>`
	res, err := e.Convert(ctx, Job{From: "html", To: "md", FormatTo: 92, Input: []byte(html)})
	if err != nil {
		t.Fatal(err)
	}
	md := string(res.Output)
	if !strings.Contains(md, "**"+tr+"**") || !strings.Contains(md, "Şehir") || !strings.Contains(md, "Iğdır") {
		t.Fatalf("md:\n%s", md)
	}
}

// ICU's conversion tables (scripts/x2t/icu-data.py): before x2t
// v9.4.0.129+3 a csv in any code page but UTF-8/16/32 and ISO-8859-1 came
// in empty. Bytes as in the app's tests/fixtures/office.ts LEGACY_CSV.
func TestConvert_ACsvInALegacyCodePageComesInWhole(t *testing.T) {
	e := engine(t)
	ctx := context.Background()
	for _, c := range []struct {
		codepage int
		name     string
		bytes    []byte
		cells    [2]string
	}{
		{36, "windows-1254", []byte{0xde, 0x65, 0x68, 0x69, 0x72, 0x3b, 0x49, 0xf0, 0x64, 0xfd, 0x72}, [2]string{"Şehir", "Iğdır"}},
		{14, "windows-1251", []byte{0xc3, 0xee, 0xf0, 0xee, 0xe4, 0x3b, 0xcc, 0xee, 0xf1, 0xea, 0xe2, 0xe0}, [2]string{"Город", "Москва"}},
		{27, "Shift_JIS", []byte{0x93, 0x8c, 0x8b, 0x9e, 0x3b, 0x91, 0xe5, 0x8d, 0xe3}, [2]string{"東京", "大阪"}},
		{18, "GBK", []byte{0xb1, 0xb1, 0xbe, 0xa9, 0x3b, 0xc9, 0xcf, 0xba, 0xa3}, [2]string{"北京", "上海"}},
	} {
		res, err := e.Convert(ctx, Job{From: "csv", To: "xlsx", Input: append(c.bytes, '\r', '\n'), Text: &TextOptions{Codepage: c.codepage, Delimiter: 2}})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		// x2t writes a csv's cells as inline strings (no sharedStrings.xml).
		s := part(t, res.Output, "xl/worksheets/sheet1.xml")
		for _, cell := range c.cells {
			if !strings.Contains(s, cell) {
				t.Errorf("%s: no %q in\n%.400s", c.name, cell, s)
			}
		}
	}
}
