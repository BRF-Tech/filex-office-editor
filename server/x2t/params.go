// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

package x2t

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Dir is where a conversion's files are in the module's file system: the
// host mounts one directory of its own there for each conversion, so two
// conversions never see each other's files.
const Dir = "/w"

var (
	extRe   = regexp.MustCompile(`^[a-z0-9]{2,5}$`)
	nameRe  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	xmlRepl = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
)

// TextOptions are what x2t needs to write a txt or csv, or to read a csv:
// the encoding (x2t's code page number, 46 is UTF-8) and, for a csv, the
// delimiter (x2t's TCSVD_*: 1 tab, 2 semicolon, 3 colon, 4 comma, 5 space)
// or a delimiter of one's own. The same names src/formats.ts gives them.
type TextOptions struct {
	Codepage      int
	Delimiter     int
	DelimiterChar string
}

// Job is one conversion: the input in a format x2t reads, the target by its
// extension and, for the targets the extension does not say (a template, a
// macro-enabled file, PDF/A), by x2t's type number.
type Job struct {
	From  string // the input's extension: docx, doc, odt, csv, bin (the editor's format)...
	To    string // the output's extension
	Input []byte

	// FormatTo is x2t's m_nFormatTo (AVS_OFFICESTUDIO_FILE_*); 0 leaves it
	// to the extension.
	FormatTo int
	// Media are the images an Editor.bin refers to, by name (without "media/").
	Media map[string][]byte
	// PDF is the editor's drawing of the pages (pdf.bin), for a PDF.
	PDF []byte
	// Fonts are font files by name, for a PDF or an image.
	Fonts map[string][]byte
	// JSON is the editor's json parameters, as a Document Server passes them.
	JSON string
	// Text is the encoding and delimiter of a txt or csv.
	Text *TextOptions
	// Password opens a password-protected document (m_sPassword).
	Password string
	// Thumbnail makes the image target a thumbnail (m_oThumbnail): the
	// first page only, fitted into Width x Height, as a Document Server's
	// ConvertService thumbnail is.
	Thumbnail *Thumbnail
}

// Thumbnail is x2t's m_oThumbnail: Format is CxImage's raster format (3
// JPEG, 4 PNG), Aspect 1 keeps the page's proportions.
type Thumbnail struct {
	Format, Aspect, Width, Height int
	First                         bool
}

func (j Job) check() error {
	if !extRe.MatchString(j.From) || !extRe.MatchString(j.To) || j.From == j.To {
		return fmt.Errorf("x2t: cannot convert %q to %q", j.From, j.To)
	}
	for n := range j.Media {
		if !nameRe.MatchString(n) {
			return fmt.Errorf("x2t: bad media name %q", n)
		}
	}
	for n := range j.Fonts {
		if !nameRe.MatchString(n) {
			return fmt.Errorf("x2t: bad font name %q", n)
		}
	}
	return nil
}

// Params is the conversion order (params.xml), as a Document Server writes
// it and as src/x2t.ts writes it in the browser. Every path in it is one
// this package chose under Dir, never a document's name.
func (j Job) Params() string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="utf-8"?>`)
	b.WriteString(`<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`)
	el := func(name, value string) {
		b.WriteString("<" + name + ">" + xmlRepl.Replace(value) + "</" + name + ">")
	}
	el("m_sFileFrom", Dir+"/input."+j.From)
	el("m_sThemeDir", Dir+"/themes")
	el("m_sFileTo", Dir+"/output."+j.To)
	el("m_sTempDir", Dir+"/tmp")
	el("m_bIsNoBase64", strconv.FormatBool(j.To == "bin"))
	if j.FormatTo > 0 {
		el("m_nFormatTo", strconv.Itoa(j.FormatTo))
	}
	if len(j.Fonts) > 0 {
		el("m_sFontDir", Dir+"/fonts/")
	}
	if j.JSON != "" {
		el("m_sJsonParams", j.JSON)
	}
	if j.Password != "" {
		el("m_sPassword", j.Password)
	}
	if t := j.Thumbnail; t != nil {
		b.WriteString("<m_oThumbnail>")
		el("format", strconv.Itoa(t.Format))
		el("aspect", strconv.Itoa(t.Aspect))
		el("first", strconv.FormatBool(t.First))
		el("zip", "false")
		el("width", strconv.Itoa(t.Width))
		el("height", strconv.Itoa(t.Height))
		b.WriteString("</m_oThumbnail>")
	}
	if t := j.Text; t != nil {
		el("m_nCsvTxtEncoding", strconv.Itoa(t.Codepage))
		if t.Delimiter > 0 {
			el("m_nCsvDelimiter", strconv.Itoa(t.Delimiter))
		}
		if t.DelimiterChar != "" {
			el("m_nCsvDelimiterChar", t.DelimiterChar)
		}
	}
	b.WriteString(`</TaskQueueDataConvert>`)
	return b.String()
}
