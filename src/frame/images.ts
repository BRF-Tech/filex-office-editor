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

import { MEDIA_NAME } from '../frame-protocol';

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

export function keepImagesInPage(common: Common | undefined): void {
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
    }
    common.g_oDocumentUrls?.addUrls?.(urls);
    callback(ERR_NO, out);
  };
}
