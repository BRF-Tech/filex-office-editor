// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page's own words (the editor has its own translations). English
// and Turkish, like the manifest.

import type { SaveRefusal, UiLang } from './config';

export interface Strings {
  opening: (name: string) => string;
  notInFilex: string;
  unsupported: (ext: string) => string;
  /** The document is in an encrypted folder (or is encrypted) and filex does not hand it over here. */
  encryptedNotHanded: string;
  openFailed: (reason: string) => string;
  saveFailed: (reason: string) => string;
  /** A save filex refused and said why (config.ts saveRefusal): nothing was
   *  written, the editor still holds the changes. */
  saveRefused: Record<SaveRefusal, string>;
  /** "Download as" or Print could not be written. */
  exportFailed: (reason: string) => string;
  /** The reason in those three when the converter (x2t) stopped on the document: `detail` is x2t's own words. */
  x2tStopped: (detail: string) => string;
  /** The reason when a conversion did not finish in time. */
  x2tTimeout: (seconds: number) => string;
  /** Print where filex cannot print yet: the PDF is handed over to print from the person's viewer. */
  printAsDownload: string;
  /** Something the editor offers that cannot be done here (a format x2t does not write, a server command). */
  notAvailable: string;
  /** On a phone: the button that leaves ONLYOFFICE's phone app (which reads only) for the editor, and its hint. */
  edit: string;
  editHint: string;
  /** On a phone, in the editor: the button back to the phone app, and its hint. */
  read: string;
  readHint: string;
  /** The switch between the two could not be made. */
  switchFailed: (reason: string) => string;
  /** Editing together (filex 0.56) could not be joined though filex offers it: the person edits alone. */
  aloneNow: (reason: string) => string;
  /** filex dropped this member (its page was unreachable a while): the editor was opened again in the session. */
  rejoined: string;
  /** An entry of the session did not check out: editing together stopped, the document opened again alone. */
  togetherBroken: string;
  /** The session's log is full: save, and the next opening starts a new session. */
  logFull: string;
  /** A change did not reach the others (filex refused it). */
  changeRefused: (code: string) => string;
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
    encryptedNotHanded:
      'This document is encrypted, and filex does not hand it to this app here. Editing an encrypted document needs filex 0.56 or later and an administrator who allows it; until then filex opens it in its own viewer.',
    openFailed: (reason) => `The document could not be opened: ${reason}`,
    saveFailed: (reason) => `The document could not be saved: ${reason}`,
    saveRefused: {
      changed:
        'Someone saved this document after you opened it, so your version was not saved over theirs. To keep your changes, download the document, then open it again.',
      vault_locked:
        'Someone else is writing to this vault right now, so the document was not saved. Your changes are still here: save again when they are done.',
      vault_lock_lost:
        "The vault's write lock ended before the save was finished, so nothing was saved. Your changes are still here: save again.",
    },
    exportFailed: (reason) => `The file could not be made: ${reason}`,
    x2tStopped: (detail) => `the converter stopped on this document (${detail})`,
    x2tTimeout: (seconds) => `the converter did not finish in ${seconds} seconds`,
    printAsDownload: 'filex cannot print from here yet: the PDF was handed to you to print from your PDF viewer.',
    notAvailable: 'That is not available in this editor.',
    edit: 'Edit',
    editHint: 'Edit this document (the phone view only reads)',
    read: 'Reading view',
    readHint: 'Back to the phone view (saves your changes first)',
    switchFailed: (reason) => `The view could not be changed: ${reason}`,
    aloneNow: (reason) => `Editing together with others is not possible right now (${reason}); you are editing this document alone.`,
    rejoined: "The connection to the people editing this document with you was lost; the document was opened again, with everybody's changes.",
    togetherBroken:
      'Editing together stopped: a change from the others could not be checked. The document was opened again as it was last saved; your changes that were already shared stay with the others.',
    logFull: 'This document has gathered as many shared changes as it can hold: save it, then open it again to go on editing together.',
    changeRefused: (code) => `A change did not reach the others (${code}).`,
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
    encryptedNotHanded:
      "Bu belge şifreli ve filex onu burada bu uygulamaya vermiyor. Şifreli bir belgeyi düzenlemek için filex 0.56 ya da sonrası ve buna izin veren bir yönetici gerekir; o zamana kadar filex onu kendi görüntüleyicisinde açar.",
    openFailed: (reason) => `Belge açılamadı: ${reason}`,
    saveFailed: (reason) => `Belge kaydedilemedi: ${reason}`,
    saveRefused: {
      changed:
        'Bu belge siz açtıktan sonra başka biri tarafından kaydedildi, bu yüzden sizin sürümünüz onunkinin üzerine kaydedilmedi. Değişikliklerinizi korumak için belgeyi indirin, sonra yeniden açın.',
      vault_locked:
        'Şu anda bu kasaya başka biri yazıyor, bu yüzden belge kaydedilmedi. Değişiklikleriniz hâlâ burada: o bitirdiğinde yeniden kaydedin.',
      vault_lock_lost:
        'Kasanın yazma kilidi kayıt bitmeden sona erdi, bu yüzden hiçbir şey kaydedilmedi. Değişiklikleriniz hâlâ burada: yeniden kaydedin.',
    },
    exportFailed: (reason) => `Dosya hazırlanamadı: ${reason}`,
    x2tStopped: (detail) => `dönüştürücü bu belgede durdu (${detail})`,
    x2tTimeout: (seconds) => `dönüştürücü ${seconds} saniyede bitiremedi`,
    printAsDownload: "filex buradan henüz yazdıramıyor: PDF size verildi, PDF görüntüleyicinizden yazdırabilirsiniz.",
    notAvailable: 'Bu işlem bu düzenleyicide kullanılamıyor.',
    edit: 'Düzenle',
    editHint: 'Bu belgeyi düzenle (telefon görünümü yalnızca okur)',
    read: 'Okuma görünümü',
    readHint: 'Telefon görünümüne dön (önce değişikliklerinizi kaydeder)',
    switchFailed: (reason) => `Görünüm değiştirilemedi: ${reason}`,
    aloneNow: (reason) => `Şu anda başkalarıyla birlikte düzenlenemiyor (${reason}); bu belgeyi tek başınıza düzenliyorsunuz.`,
    rejoined: 'Bu belgeyi sizinle birlikte düzenleyenlerle bağlantı koptu; belge herkesin değişiklikleriyle yeniden açıldı.',
    togetherBroken:
      'Birlikte düzenleme durdu: diğerlerinden gelen bir değişiklik doğrulanamadı. Belge son kaydedildiği hâliyle yeniden açıldı; daha önce paylaşılan değişiklikleriniz diğerlerinde duruyor.',
    logFull: 'Bu belge tutabileceği kadar ortak değişiklik biriktirdi: kaydedin, sonra birlikte düzenlemeye devam etmek için yeniden açın.',
    changeRefused: (code) => `Bir değişiklik diğerlerine ulaşmadı (${code}).`,
    legal: (o) =>
      `Ascensio System SIA'nın ONLYOFFICE Docs'una dayanır; bu sürüm değiştirilmiş olabilir (Docs ${o.version}, yapı ${o.build}, ONLYOFFICE kaynak etiketi ${o.tag}). ` +
      `GNU AGPL sürüm 3 ile lisanslı özgür yazılımdır; kaynak kodu: ${sourceOf(o.app)}. ` +
      "ONLYOFFICE®, Ascensio System SIA'nın tescilli markasıdır; bu uygulama onunla bağlantılı değildir ve onun tarafından onaylanmamıştır.",
    legalLabel: 'Bu düzenleyici hakkında',
  },
};
