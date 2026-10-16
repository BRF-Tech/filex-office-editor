// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Small office documents for the x2t round trips, built here from their XML
// rather than kept as binary files: a Word document, a workbook and a
// presentation, each with Turkish text (the letters outside Latin-1 - ğ Ğ
// ı İ ş Ş - as well as ç ö ü), bold and italic runs, a table, a number, a
// formula, a sheet named in Turkish; a Word document with an EMF picture,
// and csv lines in legacy code pages. Readers below take the same things
// back out of what x2t returns.

import { readZip, writeZip } from '../../scripts/lib/zip.mjs';

export const TR = {
  title: 'Şifreli belge: Iğdır, İzmir ve Çanakkale',
  body: 'Ağaç gölgesinde ışık; öğle sıcağı üşütmez. ĞÜŞİÖÇ ğüşıöç',
  bold: 'Kalın: Şükrü Öğütçü',
  italic: 'Eğik: Işıl Çağlayan',
  cells: ['Şehir', 'Sıcaklık', 'İstanbul', 'Iğdır'],
  sheet: 'Ölçümler',
  slideTitle: 'Sunum başlığı: Çağrı ölçümleri',
  slideBody: 'ığüşöç İĞÜŞÖÇ',
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zip = (parts: Record<string, string>) =>
  new Uint8Array(writeZip(Object.entries(parts).map(([name, xml]) => ({ name, data: Buffer.from(xml, 'utf8') }))));

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';

const rels = (list: Array<[string, string, string]>) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

const types = (overrides: Array<[string, string]>) =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('')}</Types>`;

export function docx(): Uint8Array {
  const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
  const doc = `${XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run(TR.title, '<w:b/><w:sz w:val="32"/>')}</w:p>
<w:p>${run(TR.body)}</w:p>
<w:p>${run(TR.bold, '<w:b/>')}${run(' / ')}${run(TR.italic, '<w:i/>')}</w:p>
<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
<w:tr>${cell(TR.cells[0])}${cell(TR.cells[1])}</w:tr><w:tr>${cell(TR.cells[2])}${cell(TR.cells[3])}</w:tr></w:tbl>
<w:p/>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  return zip({
    '[Content_Types].xml': types([['/word/document.xml', `${CT}.wordprocessingml.document.main+xml`]]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': doc,
  });
}

export function xlsx(): Uint8Array {
  const strings = [TR.cells[0], TR.cells[1], TR.cells[2], TR.cells[3], 'Toplam'];
  const s = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const n = (ref: string, v: number) => `<c r="${ref}"><v>${v}</v></c>`;
  const sheet = `${XML}<worksheet xmlns="${NS_S}" xmlns:r="${NS_R}"><sheetData>
<row r="1">${s('A1', 0)}${s('B1', 1)}</row>
<row r="2">${s('A2', 2)}${n('B2', 18.5)}</row>
<row r="3">${s('A3', 3)}${n('B3', 21)}</row>
<row r="4">${s('A4', 4)}<c r="B4"><f>SUM(B2:B3)</f><v>39.5</v></c></row>
</sheetData></worksheet>`;
  return zip({
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', `${CT}.spreadsheetml.sheet.main+xml`],
      ['/xl/worksheets/sheet1.xml', `${CT}.spreadsheetml.worksheet+xml`],
      ['/xl/sharedStrings.xml', `${CT}.spreadsheetml.sharedStrings+xml`],
      ['/xl/styles.xml', `${CT}.spreadsheetml.styles+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS_S}" xmlns:r="${NS_R}"><sheets><sheet name="${esc(TR.sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([
      ['rId1', 'worksheet', 'worksheets/sheet1.xml'],
      ['rId2', 'sharedStrings', 'sharedStrings.xml'],
      ['rId3', 'styles', 'styles.xml'],
    ]),
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': `${XML}<sst xmlns="${NS_S}" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((t) => `<si><t>${esc(t)}</t></si>`)
      .join('')}</sst>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS_S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  });
}

const THEME = `${XML}<a:theme xmlns:a="${NS_A}" name="Office"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

export function pptx(): Uint8Array {
  const para = (text: string, bold: boolean) =>
    `<a:p><a:r><a:rPr lang="tr-TR"${bold ? ' b="1"' : ''} dirty="0"/><a:t>${esc(text)}</a:t></a:r></a:p>`;
  const slide = `${XML}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${GROUP}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Metin 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${para(TR.slideTitle, true)}${para(TR.slideBody, false)}</p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return zip({
    '[Content_Types].xml': types([
      ['/ppt/presentation.xml', `${CT}.presentationml.presentation.main+xml`],
      ['/ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`],
      ['/ppt/slideLayouts/slideLayout1.xml', `${CT}.presentationml.slideLayout+xml`],
      ['/ppt/slides/slide1.xml', `${CT}.presentationml.slide+xml`],
      ['/ppt/theme/theme1.xml', `${CT}.theme+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `${XML}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'theme', 'theme/theme1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/theme/theme1.xml': THEME,
  });
}

/** The two sentences of odtWithFormula: one ends with the formula, the other has it between two words. */
export const FORMULA = { end: `${TR.cells[3]}:`, before: 'Önce', after: 'sonra metin.' };

const NS_ODF = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
};
const odfNs = Object.entries(NS_ODF)
  .map(([k, v]) => `xmlns:${k}="${v}"`)
  .join(' ');

/**
 * An odt with a formula (a + b) in two sentences - at the end of the first,
 * between two words in the second - the way LibreOffice writes one: an
 * embedded object per formula ("Object 1", "Object 2") holding MathML with
 * its StarMath annotation, in a frame anchored as a character.
 *
 * `styled`: the frames carry the style LibreOffice gives every formula (an
 * automatic style "fr1" whose parent is the "Formula" graphic style of
 * styles.xml), as in an odt LibreOffice 7.6 wrote, measured. Without it the
 * frames have no style - valid ODF, as other producers write it - which x2t
 * read as a floating shape at the top left of the margin until
 * scripts/x2t/patches/05-frame-anchor.patch.
 */
export function odtWithFormula(o: { styled: boolean }): Uint8Array {
  const X = '<?xml version="1.0" encoding="UTF-8"?>';
  const style = o.styled ? ' draw:style-name="fr1"' : '';
  const frame = (n: number) =>
    `<draw:frame${style} draw:name="Object${n}" text:anchor-type="as-char" svg:width="0.8cm" svg:height="0.5cm">` +
    `<draw:object xlink:href="./Object ${n}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  const automatic = o.styled
    ? '<office:automatic-styles><style:style style:name="fr1" style:family="graphic" style:parent-style-name="Formula">' +
      '<style:graphic-properties fo:margin-left="0cm" fo:margin-right="0cm" style:vertical-pos="middle" style:vertical-rel="text"/></style:style></office:automatic-styles>'
    : '';
  const content =
    `${X}<office:document-content ${odfNs} office:version="1.3">${automatic}<office:body><office:text>` +
    `<text:p>${esc(FORMULA.end)} ${frame(1)}</text:p>` +
    `<text:p>${esc(FORMULA.before)} ${frame(2)} ${esc(FORMULA.after)}</text:p>` +
    '</office:text></office:body></office:document-content>';
  const styles =
    `${X}<office:document-styles ${odfNs} office:version="1.3"><office:styles>` +
    '<style:style style:name="Formula" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" ' +
    'fo:margin-left="0cm" fo:margin-right="0cm" style:vertical-pos="middle" style:vertical-rel="text" draw:fill="none"/></style:style>' +
    '</office:styles></office:document-styles>';
  const math =
    `${X}<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>a</mi><mo stretchy="false">+</mo><mi>b</mi></mrow>` +
    '<annotation encoding="StarMath 5.0">a + b</annotation></semantics></math>';
  const entry = (path: string, type: string) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`;
  const manifest =
    `${X}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    entry('/', 'application/vnd.oasis.opendocument.text') +
    entry('content.xml', 'text/xml') +
    (o.styled ? entry('styles.xml', 'text/xml') : '') +
    [1, 2].map((n) => entry(`Object ${n}/content.xml`, 'text/xml') + entry(`Object ${n}/`, 'application/vnd.oasis.opendocument.formula')).join('') +
    '</manifest:manifest>';
  return zip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': content,
    ...(o.styled ? { 'styles.xml': styles } : {}),
    'Object 1/content.xml': math,
    'Object 2/content.xml': math,
    'META-INF/manifest.xml': manifest,
  });
}

/**
 * An OFD package (the Chinese fixed-layout format, GB/T 33190): OFD.xml, a
 * document and an empty page. x2t knows a file by what it holds, not by its
 * name, and the build has no OFD reader (the link leaves COFDFile out,
 * README.md "x2t, the converter"): converting it stops the module -
 * "Aborted(missing function: _ZN8COFDFileC1EPN7NSFonts17IApplicationFontsE)",
 * measured. Named .docx, it is the document the measurements open to see
 * x2t stop (e2e/make-docs.mjs stops.docx).
 */
export function ofdPackage(): Uint8Array {
  const X = '<?xml version="1.0" encoding="UTF-8"?>';
  const NS = 'xmlns:ofd="http://www.ofdspec.org/2016"';
  return zip({
    'OFD.xml':
      `${X}<ofd:OFD ${NS} Version="1.0" DocType="OFD"><ofd:DocBody><ofd:DocInfo><ofd:DocID>0</ofd:DocID></ofd:DocInfo>` +
      '<ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>',
    'Doc_0/Document.xml':
      `${X}<ofd:Document ${NS}><ofd:CommonData><ofd:MaxUnitID>1</ofd:MaxUnitID><ofd:PageArea><ofd:PhysicalBox>0 0 210 297</ofd:PhysicalBox></ofd:PageArea></ofd:CommonData>` +
      '<ofd:Pages><ofd:Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/></ofd:Pages></ofd:Document>',
    'Doc_0/Pages/Page_0/Content.xml': `${X}<ofd:Page ${NS}><ofd:Content/></ofd:Page>`,
  });
}

// ---- pictures and legacy encodings (docs/PARITY.md A14 and A3) ---------

/**
 * A small EMF picture, 132 bytes: its header (100 x 70 device units, a
 * frame of 26.46 x 18.52 mm), one rectangle, the end of the file. Opening it
 * goes through ONLYOFFICE's metafile code, which x2t uses for every EMF, WMF
 * and SVG picture (it writes an EMF as SVG for the editor).
 */
export function emfPicture(): Uint8Array {
  const b = Buffer.alloc(132);
  let o = 0;
  const u32 = (...v: number[]) => v.forEach((x) => (o = b.writeUInt32LE(x, o)));
  const i32 = (...v: number[]) => v.forEach((x) => (o = b.writeInt32LE(x, o)));
  const u16 = (...v: number[]) => v.forEach((x) => (o = b.writeUInt16LE(x, o)));
  // EMR_HEADER: type, size, bounds, frame (0.01 mm), " EMF", version, bytes, records, handles, reserved,
  // description (length, offset), palette entries, the device in pixels and in millimetres.
  u32(1, 88);
  i32(0, 0, 100, 70, 0, 0, 2646, 1852);
  u32(0x464d4520, 0x10000, 132, 3);
  u16(1, 0);
  u32(0, 0, 0);
  i32(1024, 768, 270, 203);
  u32(43, 24); // EMR_RECTANGLE
  i32(10, 10, 90, 60);
  u32(14, 20, 0, 16, 20); // EMR_EOF
  return new Uint8Array(b);
}

/** A Word document with a line of Turkish text and one picture, inline, as word/media/image1.<ext>. */
export function docxWithPicture(picture: Uint8Array, ext: string, contentType: string): Uint8Array {
  const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const size = 'cx="952500" cy="666750"';
  const doc = `${XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>
<w:p><w:r><w:t xml:space="preserve">${esc(TR.title)}</w:t></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent ${size}/><wp:docPr id="1" name="Resim 1"/><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="1" name="image1.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
</w:body></w:document>`;
  const xml: Record<string, string> = {
    '[Content_Types].xml': types([['/word/document.xml', `${CT}.wordprocessingml.document.main+xml`]]).replace(
      '<Default Extension="xml"',
      `<Default Extension="${ext}" ContentType="${contentType}"/><Default Extension="xml"`,
    ),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': rels([['rId2', 'image', `media/image1.${ext}`]]),
    'word/document.xml': doc,
  };
  const entries = Object.entries(xml).map(([name, s]) => ({ name, data: Buffer.from(s, 'utf8') }));
  entries.push({ name: `word/media/image1.${ext}`, data: Buffer.from(picture) });
  return new Uint8Array(writeZip(entries));
}

/**
 * A Word document with a line of Turkish text and one picture it only links
 * to, at `url` (a relationship with TargetMode="External", `r:link`): Word
 * writes one for Insert Picture > Link to File.
 */
export function docxWithLinkedPicture(url: string): Uint8Array {
  const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const size = 'cx="952500" cy="666750"';
  const doc = `${XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>
<w:p><w:r><w:t xml:space="preserve">${esc(TR.title)}</w:t></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent ${size}/><wp:docPr id="1" name="Resim 1"/><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="1" name="far.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:link="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
</w:body></w:document>`;
  return zip({
    '[Content_Types].xml': types([['/word/document.xml', `${CT}.wordprocessingml.document.main+xml`]]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${REL}/image" Target="${esc(url)}" TargetMode="External"/></Relationships>`,
    'word/document.xml': doc,
  });
}

/**
 * Two cells of a csv line in a code page other than Unicode - the bytes
 * and the text they hold - by x2t's number for the encoding
 * (m_nCsvTxtEncoding, core's UnicodeConverter_Encodings.h). The multi-byte
 * ones each need a table that extends another (ICU's windows-936-2000 is
 * ibm-1386's, and so on): scripts/x2t/icu-converters.txt carries both.
 */
export const LEGACY_CSV: ReadonlyArray<{ codepage: number; name: string; bytes: readonly number[]; cells: readonly [string, string] }> = [
  { codepage: 36, name: 'windows-1254', bytes: [0xde, 0x65, 0x68, 0x69, 0x72, 0x3b, 0x49, 0xf0, 0x64, 0xfd, 0x72], cells: ['Şehir', 'Iğdır'] },
  { codepage: 14, name: 'windows-1251', bytes: [0xc3, 0xee, 0xf0, 0xee, 0xe4, 0x3b, 0xcc, 0xee, 0xf1, 0xea, 0xe2, 0xe0], cells: ['Город', 'Москва'] },
  { codepage: 44, name: 'windows-1252', bytes: [0x43, 0x61, 0x66, 0xe9, 0x3b, 0x47, 0x72, 0xf6, 0xdf, 0x65], cells: ['Café', 'Größe'] },
  { codepage: 27, name: 'Shift_JIS', bytes: [0x93, 0x8c, 0x8b, 0x9e, 0x3b, 0x91, 0xe5, 0x8d, 0xe3], cells: ['東京', '大阪'] },
  { codepage: 18, name: 'GBK', bytes: [0xb1, 0xb1, 0xbe, 0xa9, 0x3b, 0xc9, 0xcf, 0xba, 0xa3], cells: ['北京', '上海'] },
  { codepage: 17, name: 'Big5', bytes: [0xbb, 0x4f, 0xa5, 0x5f, 0x3b, 0xb0, 0xaa, 0xb6, 0xaf], cells: ['臺北', '高雄'] },
  { codepage: 28, name: 'KS_C_5601-1987', bytes: [0xbc, 0xad, 0xbf, 0xef, 0x3b, 0xba, 0xce, 0xbb, 0xea], cells: ['서울', '부산'] },
];

/**
 * A sample of each code page of x2t's list (the editor's TXT and CSV
 * dialogs, AscCommon.c_oAscEncodings, by x2t's number), with the bytes a
 * csv line "<sample>;abc" is in that encoding - Python's codecs, which
 * x2t v9.4.0.129+3 matched in every one of them (measured 2026-10-16,
 * read back the same too). A byte order mark, where x2t writes one (UTF-8,
 * UTF-16), comes before them.
 */
export const CSV_SAMPLES: ReadonlyArray<{ codepage: number; name: string; sample: string; bytes: string }> = [
  { codepage: 0, name: 'ISO-8859-6', sample: 'مرحبا', bytes: 'e5d1cdc8c73b616263' },
  { codepage: 1, name: 'DOS-720', sample: 'مرحبا', bytes: 'eaa9a5a09f3b616263' },
  { codepage: 2, name: 'windows-1256', sample: 'مرحبا', bytes: 'e3d1cdc8c73b616263' },
  { codepage: 3, name: 'ISO-8859-4', sample: 'Ąčęėįšųūž', bytes: 'a1e8eaece7b9f9febe3b616263' },
  { codepage: 4, name: 'ISO-8859-13', sample: 'Ąčęėįšųūž', bytes: 'c0e8e6ebe1f0f8fbfe3b616263' },
  { codepage: 5, name: 'IBM775', sample: 'Ąčęėįšųūž', bytes: 'b5d1d2d3d4d5d6d7d83b616263' },
  { codepage: 6, name: 'windows-1257', sample: 'Ąčęėįšųūž', bytes: 'c0e8e6ebe1f0f8fbfe3b616263' },
  { codepage: 7, name: 'ISO-8859-14', sample: 'Ŵŷ ẁẃ', bytes: 'd0fe20b8ba3b616263' },
  { codepage: 8, name: 'ISO-8859-5', sample: 'Привет', bytes: 'bfe0d8d2d5e23b616263' },
  { codepage: 9, name: 'KOI8-R', sample: 'Привет', bytes: 'f0d2c9d7c5d43b616263' },
  { codepage: 10, name: 'KOI8-U', sample: 'Привіт', bytes: 'f0d2c9d7a6d43b616263' },
  { codepage: 11, name: 'x-mac-cyrillic', sample: 'Привет', bytes: '8ff0e8e2e5f23b616263' },
  { codepage: 12, name: 'IBM855', sample: 'Привет', bytes: 'dde1b7eba8e53b616263' },
  { codepage: 13, name: 'cp866', sample: 'Привет', bytes: '8fe0a8a2a5e23b616263' },
  { codepage: 14, name: 'windows-1251', sample: 'Привет', bytes: 'cff0e8e2e5f23b616263' },
  { codepage: 15, name: 'IBM852', sample: 'Łódź Žluťoučký', bytes: '9da264ab20a66c759c6f759f6bec3b616263' },
  { codepage: 16, name: 'windows-1250', sample: 'Łódź Žluťoučký', bytes: 'a3f3649f208e6c759d6f75e86bfd3b616263' },
  { codepage: 17, name: 'Big5', sample: '臺北', bytes: 'bb4fa55f3b616263' },
  { codepage: 18, name: 'GBK', sample: '北京', bytes: 'b1b1bea93b616263' },
  { codepage: 19, name: 'ISO-8859-2', sample: 'Łódź Žluťoučký', bytes: 'a3f364bc20ae6c75bb6f75e86bfd3b616263' },
  { codepage: 20, name: 'ISO-8859-7', sample: 'ΑΘΗΝΑ αθηνα', bytes: 'c1c8c7cdc120e1e8e7ede13b616263' },
  { codepage: 21, name: 'IBM737', sample: 'ΑΘΗΝΑ αθηνα', bytes: '8087868c8020989f9ea4983b616263' },
  { codepage: 22, name: 'IBM869', sample: 'ΑΘΗΝΑ αθηνα', bytes: 'a4acaab8a420d6e2e1e7d63b616263' },
  { codepage: 23, name: 'windows-1253', sample: 'ΑΘΗΝΑ αθηνα', bytes: 'c1c8c7cdc120e1e8e7ede13b616263' },
  { codepage: 24, name: 'ISO-8859-8', sample: 'שלום', bytes: 'f9ece5ed3b616263' },
  { codepage: 25, name: 'DOS-862', sample: 'שלום', bytes: '998c858d3b616263' },
  { codepage: 26, name: 'windows-1255', sample: 'שלום', bytes: 'f9ece5ed3b616263' },
  { codepage: 27, name: 'Shift_JIS', sample: '東京', bytes: '938c8b9e3b616263' },
  { codepage: 28, name: 'KS_C_5601-1987', sample: '서울', bytes: 'bcadbfef3b616263' },
  { codepage: 29, name: 'EUC-KR', sample: '서울', bytes: 'bcadbfef3b616263' },
  { codepage: 30, name: 'IBM861', sample: 'Þórður', bytes: '8da2728c75723b616263' },
  { codepage: 31, name: 'IBM865', sample: 'Ærø', bytes: '92729b3b616263' },
  { codepage: 32, name: 'windows-874', sample: 'สวัสดี', bytes: 'cac7d1cab4d53b616263' },
  { codepage: 33, name: 'ISO-8859-3', sample: 'Şehir Iğdır İzmir', bytes: 'aa656869722049bb64b97220a97a6d69723b616263' },
  { codepage: 34, name: 'ISO-8859-9', sample: 'Şehir Iğdır İzmir', bytes: 'de656869722049f064fd7220dd7a6d69723b616263' },
  { codepage: 35, name: 'IBM857', sample: 'Şehir Iğdır İzmir', bytes: '9e656869722049a7648d7220987a6d69723b616263' },
  { codepage: 36, name: 'windows-1254', sample: 'Şehir Iğdır İzmir', bytes: 'de656869722049f064fd7220dd7a6d69723b616263' },
  { codepage: 37, name: 'ISO-8859-1', sample: 'Café Größe', bytes: '436166e9204772f6df653b616263' },
  { codepage: 38, name: 'ISO-8859-15', sample: 'Café 5 €', bytes: '436166e9203520a43b616263' },
  { codepage: 39, name: 'IBM850', sample: 'Café Größe', bytes: '4361668220477294e1653b616263' },
  { codepage: 40, name: 'IBM858', sample: 'Café 5 €', bytes: '43616682203520d53b616263' },
  { codepage: 41, name: 'IBM860', sample: 'Ação', bytes: '4187846f3b616263' },
  { codepage: 42, name: 'IBM863', sample: 'Québec', bytes: '5175826265633b616263' },
  { codepage: 43, name: 'IBM437', sample: 'Café Größe', bytes: '4361668220477294e1653b616263' },
  { codepage: 44, name: 'windows-1252', sample: 'Café 5 €', bytes: '436166e9203520803b616263' },
  { codepage: 45, name: 'windows-1258', sample: 'Đđ Ơơ Ưư', bytes: 'd0f020d5f520ddfd3b616263' },
  { codepage: 46, name: 'UTF-8', sample: 'Şehir 東京', bytes: 'c59e6568697220e69db1e4baac3b616263' },
  { codepage: 47, name: 'UTF-7', sample: 'Şehir 東京', bytes: '2b4156342d65686972202b5a33464f72413b616263' },
  { codepage: 48, name: 'UTF-16LE', sample: 'Şehir 東京', bytes: '5e01650068006900720020007167ac4e3b00610062006300' },
  { codepage: 49, name: 'UTF-16BE', sample: 'Şehir 東京', bytes: '015e0065006800690072002067714eac003b006100620063' },
  { codepage: 50, name: 'UTF-32LE', sample: 'Şehir 東京', bytes: '5e010000650000006800000069000000720000002000000071670000ac4e00003b000000610000006200000063000000' },
  { codepage: 51, name: 'UTF-32BE', sample: 'Şehir 東京', bytes: '0000015e00000065000000680000006900000072000000200000677100004eac0000003b000000610000006200000063' },
  { codepage: 52, name: 'EUC-JP', sample: '東京', bytes: 'c5ecb5fe3b616263' },
  { codepage: 53, name: 'GB18030', sample: '北京', bytes: 'b1b1bea93b616263' },
];

/** A workbook of one sheet, one row: the two cells as inline strings. */
export function xlsxWithCells(a1: string, b1: string): Uint8Array {
  const cell = (ref: string, t: string) => `<c r="${ref}" t="inlineStr"><is><t>${esc(t)}</t></is></c>`;
  return zip({
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', `${CT}.spreadsheetml.sheet.main+xml`],
      ['/xl/worksheets/sheet1.xml', `${CT}.spreadsheetml.worksheet+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS_S}" xmlns:r="${NS_R}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${NS_S}"><sheetData><row r="1">${cell('A1', a1)}${cell('B1', b1)}</row></sheetData></worksheet>`,
  });
}

// ---- reading what comes back -------------------------------------------

const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The parts of an office file, as text (XML) by name. */
export function parts(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of readZip(bytes)) if (!e.isDir) out.set(e.name, e.read().toString('utf8'));
  return out;
}

/** The text of each element `tag` (w:t, a:t, t) in an XML part, unescaped. */
export function texts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => unesc(m[1]));
}

/** The paragraphs of a Word document's body, their runs' text joined. */
export function docxParagraphs(documentXml: string): string[] {
  return [...documentXml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((m) => texts(m[0], 'w:t').join('')).filter((t) => t !== '');
}

/**
 * The lines of a Word document's body with its formulas in place: each
 * OOXML math (m:oMath) as "[its text]" where it is in the XML, one line per
 * paragraph, spaces collapsed ("Iğdır: [a+b]"). Where a formula is drawn -
 * in the line, or as a floating shape (wp:anchor) - the XML order does not
 * say; a test asks that separately.
 */
export function formulaLines(documentXml: string): string[] {
  const re = /<m:oMath(?:\s[^>]*)?>([\s\S]*?)<\/m:oMath>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>/g;
  let out = '';
  for (const m of documentXml.matchAll(re)) {
    if (m[1] !== undefined) out += `[${texts(m[1], 'm:t').join('')}]`;
    else if (m[2] !== undefined) out += unesc(m[2]);
    else out += '\n';
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s*\[/g, ' [').replace(/\]\s*/g, '] ').replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** The runs of a Word document: their text, and whether they are bold or italic. */
export function docxRuns(documentXml: string): Array<{ text: string; bold: boolean; italic: boolean }> {
  return [...documentXml.matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)].map((m) => {
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(m[0])?.[1] ?? '';
    const on = (name: string) => {
      const p = new RegExp(`<w:${name}(\\s[^>]*)?/>`).exec(props);
      return !!p && !/w:val="(0|false)"/.test(p[1] ?? '');
    };
    return { text: texts(m[0], 'w:t').join(''), bold: on('b'), italic: on('i') };
  });
}
