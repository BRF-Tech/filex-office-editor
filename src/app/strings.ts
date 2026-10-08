// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page's own words (the editor has its own translations). English
// and Turkish, like the manifest.

import type { UiLang } from './config';

export interface Strings {
  opening: (name: string) => string;
  notInFilex: string;
  unsupported: (ext: string) => string;
  openFailed: (reason: string) => string;
  saveFailed: (reason: string) => string;
  /** "Download as" or Print could not be written. */
  exportFailed: (reason: string) => string;
  /** Print where filex cannot print yet: the PDF is handed over to print from the person's viewer. */
  printAsDownload: string;
  /** The notice ONLYOFFICE's terms ask for: whose work it is, that it is modified, where the source is. */
  legal: (o: LegalFacts) => string;
  legalLabel: string;
}

const SOURCE = 'github.com/BRF-Tech/filex-office-editor';

export interface LegalFacts {
  /** ONLYOFFICE Docs' version and build the editor files are from. */
  version: string;
  build: number;
  /** ONLYOFFICE's source tag for them. */
  tag: string;
  /** This app's version ("0.0.0" for a build between releases). */
  app: string;
}

/** Where this exact version's source is: the release's tag, or the repository for a build between releases. */
export function sourceOf(app: string): string {
  return /^\d+\.\d+\.\d+$/.test(app) && app !== '0.0.0' ? `${SOURCE}/tree/v${app}` : SOURCE;
}

export const STRINGS: Record<UiLang, Strings> = {
  en: {
    opening: (name) => `Opening ${name}…`,
    notInFilex: 'This page is the office editor app for filex; it opens inside filex.',
    unsupported: (ext) => `This app does not open .${ext} files.`,
    openFailed: (reason) => `The document could not be opened: ${reason}`,
    saveFailed: (reason) => `The document could not be saved: ${reason}`,
    exportFailed: (reason) => `The file could not be made: ${reason}`,
    printAsDownload: 'filex cannot print from here yet: the PDF was handed to you to print from your PDF viewer.',
    legal: (o) =>
      `Based on ONLYOFFICE Docs by Ascensio System SIA; this version may have been modified (Docs ${o.version}, build ${o.build}, ONLYOFFICE source tag ${o.tag}). ` +
      `Free software under the GNU AGPL version 3; source code: ${sourceOf(o.app)}. ` +
      'ONLYOFFICE® is a registered trademark of Ascensio System SIA; this app is not affiliated with or endorsed by it.',
    legalLabel: 'About this editor',
  },
  tr: {
    opening: (name) => `${name} açılıyor…`,
    notInFilex: "Bu sayfa filex'in ofis düzenleyici uygulamasıdır; filex'in içinde açılır.",
    unsupported: (ext) => `Bu uygulama .${ext} dosyalarını açmaz.`,
    openFailed: (reason) => `Belge açılamadı: ${reason}`,
    saveFailed: (reason) => `Belge kaydedilemedi: ${reason}`,
    exportFailed: (reason) => `Dosya hazırlanamadı: ${reason}`,
    printAsDownload: "filex buradan henüz yazdıramıyor: PDF size verildi, PDF görüntüleyicinizden yazdırabilirsiniz.",
    legal: (o) =>
      `Ascensio System SIA'nın ONLYOFFICE Docs'una dayanır; bu sürüm değiştirilmiş olabilir (Docs ${o.version}, yapı ${o.build}, ONLYOFFICE kaynak etiketi ${o.tag}). ` +
      `GNU AGPL sürüm 3 ile lisanslı özgür yazılımdır; kaynak kodu: ${sourceOf(o.app)}. ` +
      "ONLYOFFICE®, Ascensio System SIA'nın tescilli markasıdır; bu uygulama onunla bağlantılı değildir ve onun tarafından onaylanmamıştır.",
    legalLabel: 'Bu düzenleyici hakkında',
  },
};
