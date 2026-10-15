// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package x2t

import (
	"strings"
	"testing"
)

func TestParams_TheOrderAsADocumentServerWritesIt(t *testing.T) {
	p := Job{From: "docx", To: "bin", Input: []byte("x")}.Params()
	for _, want := range []string{
		`<m_sFileFrom>/w/input.docx</m_sFileFrom>`,
		`<m_sFileTo>/w/output.bin</m_sFileTo>`,
		`<m_sTempDir>/w/tmp</m_sTempDir>`,
		`<m_bIsNoBase64>true</m_bIsNoBase64>`,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("params lack %s:\n%s", want, p)
		}
	}
	if strings.Contains(p, "m_nFormatTo") || strings.Contains(p, "m_sFontDir") {
		t.Errorf("params name what was not asked for:\n%s", p)
	}
}

func TestParams_CsvThumbnailPasswordAndJsonAreEscaped(t *testing.T) {
	p := Job{
		From: "bin", To: "png", FormatTo: 0x0405,
		Fonts:     map[string][]byte{"004.ttf": {1}},
		JSON:      `{"a":"<b>&"}`,
		Password:  `p"<&>`,
		Text:      &TextOptions{Codepage: 46, Delimiter: 2, DelimiterChar: "|"},
		Thumbnail: &Thumbnail{Format: 4, Aspect: 1, First: true, Width: 320, Height: 320},
	}.Params()
	for _, want := range []string{
		`<m_nFormatTo>1029</m_nFormatTo>`,
		`<m_sFontDir>/w/fonts/</m_sFontDir>`,
		`<m_sJsonParams>{&quot;a&quot;:&quot;&lt;b&gt;&amp;&quot;}</m_sJsonParams>`,
		`<m_sPassword>p&quot;&lt;&amp;&gt;</m_sPassword>`,
		`<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding><m_nCsvDelimiter>2</m_nCsvDelimiter><m_nCsvDelimiterChar>|</m_nCsvDelimiterChar>`,
		`<m_oThumbnail><format>4</format><aspect>1</aspect><first>true</first><zip>false</zip><width>320</width><height>320</height></m_oThumbnail>`,
		`<m_bIsNoBase64>false</m_bIsNoBase64>`,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("params lack %s:\n%s", want, p)
		}
	}
}

func TestJob_RefusesNamesThatAreNotItsOwn(t *testing.T) {
	for _, j := range []Job{
		{From: "docx", To: "docx"},
		{From: "../x", To: "odt"},
		{From: "docx", To: "odt/x"},
		{From: "bin", To: "pdf", Media: map[string][]byte{"../etc": nil}},
		{From: "bin", To: "pdf", Fonts: map[string][]byte{"a/b.ttf": nil}},
	} {
		if err := j.check(); err == nil {
			t.Errorf("%+v: accepted", j)
		}
	}
}
