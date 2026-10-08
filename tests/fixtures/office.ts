// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Small office documents for the x2t round trips, built here from their XML
// rather than kept as binary files: a Word document, a workbook and a
// presentation, each with Turkish text (the letters outside Latin-1 - ğ Ğ
// ı İ ş Ş - as well as ç ö ü), bold and italic runs, a table, a number, a
// formula, a sheet named in Turkish. Readers below take the same things
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
