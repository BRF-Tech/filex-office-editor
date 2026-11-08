// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// An image the person inserts from their computer. The editor uploads it to
// the Document Server (AscCommon.UploadImageFiles: a POST to its upload
// service, which answers the image's name in the document and an address);
// there is no server here, so the image stays in the page: a blob: address
// of this page, registered under a new media/ name the way the server's
// answer would have registered it. A save takes it from there like every
// other image of the document (frame/main.ts snapshotMedia). CryptPad's
// editor does the same with the same function.
//
// The limits are the Document Server's (bridge.ts sends them in the auth
// answer): the types the editor may upload, 25 MiB.
//
// Editing together (filex 0.56), the other members need the image too: the
// hook hands it to the session (relay-session.ts imageInserted), which keeps
// it with filex before the change that shows it goes out. Its name is the
// one the change carries (`image_fx<16 hex>.<ext>`, coedit.ts INSERTED_IMAGE).
//
// In 10.0 UploadImageFiles is renamed (sdk.ts); the request it makes is not:
// uploadAnswer answers that POST (requests.ts) with the Document Server's
// answer, and the editor registers the image itself.

import { MEDIA_NAME } from '../frame-protocol';
import type { UploadAnswer } from './requests';

/** c_oAscError.ID values the upload answers with (sdkjs common/errorCodes.js). */
const ERR_NO = 0;
const ERR_UPL_IMAGE_SIZE = -9;
const ERR_UPL_IMAGE_EXT = -10;

const MAX_BYTES = 26214400;
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

type Callback = (code: number, urls?: string[]) => void;

interface Common {
  UploadImageFiles?: (files: ArrayLike<Blob>, ...rest: unknown[]) => void;
  g_oDocumentUrls?: { addUrls?: (urls: Record<string, string>) => void };
  __filexImages?: boolean;
}

function randomName(ext: string): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `image_fx${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}.${ext}`;
}

/** The extension an inserted image is kept under, or null when the editor may not take it. */
export function imageExt(file: { type?: string; name?: string }): string | null {
  const byType = TYPES[String(file.type ?? '').toLowerCase()];
  if (byType) return byType;
  const m = /\.(jpe?g|jpe|png|gif|bmp|tiff?)$/i.exec(String(file.name ?? ''));
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'jpeg' || e === 'jpe' ? 'jpg' : e === 'tif' ? 'tiff' : e;
}

/** Told about every image the person inserts, by its name in the document (without "media/"). */
export type ImageInserted = (name: string, file: Blob) => void;

export function keepImagesInPage(common: Common | undefined, inserted?: ImageInserted): void {
  if (!common || common.__filexImages || typeof common.UploadImageFiles !== 'function') return;
  common.__filexImages = true;
  common.UploadImageFiles = function (files: ArrayLike<Blob>, ...rest: unknown[]) {
    const callback = rest[rest.length - 1] as Callback;
    if (typeof callback !== 'function') return;
    const urls: Record<string, string> = {};
    const out: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as Blob & { name?: string };
      const ext = imageExt(f);
      if (!ext) {
        callback(ERR_UPL_IMAGE_EXT);
        return;
      }
      if (f.size > MAX_BYTES) {
        callback(ERR_UPL_IMAGE_SIZE);
        return;
      }
      const name = randomName(ext);
      if (!MEDIA_NAME.test(name)) continue;
      const url = URL.createObjectURL(f);
      urls[`media/${name}`] = url;
      out.push(url);
      inserted?.(name, f);
    }
    common.g_oDocumentUrls?.addUrls?.(urls);
    callback(ERR_NO, out);
  };
}

/**
 * The upload request's answer (10.0; requests.ts): as the Document Server
 * answers it, `{"media/<name>": address}` - the image kept in the page under
 * a new name - or 415 for a type the editor may not take, 413 over the
 * limit, which the editor tells the person as it tells a server's.
 */
export function uploadAnswer(inserted?: ImageInserted): (file: Blob) => UploadAnswer {
  return (f) => {
    const ext = imageExt(f as Blob & { name?: string });
    if (!ext) return { status: 415 };
    if (f.size > MAX_BYTES) return { status: 413 };
    const name = randomName(ext);
    if (!MEDIA_NAME.test(name)) return { status: 500 };
    const url = URL.createObjectURL(f);
    inserted?.(name, f);
    return { status: 200, body: JSON.stringify({ [`media/${name}`]: url }) };
  };
}
