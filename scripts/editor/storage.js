// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Served as filex/storage.js in the editor bundle and loaded as the first
// script of every ONLYOFFICE page in it (scripts/editor/html.mjs).
//
// filex runs an app in a sandboxed frame with an opaque origin, where the
// browser has no storage to give: reading window.localStorage throws a
// SecurityError. The editor keeps its settings there (theme, zoom, units,
// recent fonts...) and does not expect the read itself to fail everywhere.
// This gives such a page an in-memory localStorage and sessionStorage that
// behave like the real ones (getItem/setItem/removeItem/clear/key/length,
// and the named properties) for as long as the page lives. Where the browser
// does give storage, nothing is replaced. It also takes away
// navigator.serviceWorker where reading it throws (below).
(function () {
  'use strict';

  function memoryStorage() {
    var data = new Map();
    var api = {
      getItem: function (k) {
        k = String(k);
        return data.has(k) ? data.get(k) : null;
      },
      setItem: function (k, v) {
        data.set(String(k), String(v));
      },
      removeItem: function (k) {
        data.delete(String(k));
      },
      clear: function () {
        data.clear();
      },
      key: function (i) {
        var keys = Array.from(data.keys());
        i = Number(i);
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
    };
    return new Proxy(api, {
      get: function (target, prop) {
        if (prop === 'length') return data.size;
        if (typeof prop === 'symbol' || Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        return data.has(prop) ? data.get(prop) : undefined;
      },
      set: function (target, prop, value) {
        if (typeof prop === 'symbol' || Object.prototype.hasOwnProperty.call(target, prop) || prop === 'length') return true;
        data.set(prop, String(value));
        return true;
      },
      has: function (target, prop) {
        return typeof prop === 'string' && (data.has(prop) || prop in target || prop === 'length');
      },
      deleteProperty: function (target, prop) {
        if (typeof prop === 'string') data.delete(prop);
        return true;
      },
      ownKeys: function () {
        return Array.from(data.keys());
      },
      getOwnPropertyDescriptor: function (target, prop) {
        if (typeof prop === 'string' && data.has(prop)) {
          return { value: data.get(prop), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var works = false;
    try {
      works = !!window[name];
    } catch (e) {
      works = false;
    }
    if (works) return;
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true, enumerable: true, writable: false });
    } catch (e) {
      // A browser that neither gives storage nor lets the page define it:
      // the editor runs without settings, as it would anyway.
    }
  });

  // No service workers either. In Chromium even reading
  // navigator.serviceWorker throws in such a page ("SecurityError: Service
  // worker is disabled because the context is sandboxed and lacks the
  // 'allow-same-origin' flag"): ONLYOFFICE's phone apps read it while
  // Framework7 starts, and the throw stopped them before anything showed
  // (measured 2026-10-08); the editors ask `'serviceWorker' in navigator`
  // first and then fail to register. Where the read throws, the attribute
  // is taken away, so `in` says no and both go on without one.
  var nav = window.navigator;
  if (!nav) return;
  try {
    void nav.serviceWorker;
  } catch (e) {
    var proto = window.Navigator && window.Navigator.prototype;
    try {
      if (proto) delete proto.serviceWorker;
    } catch (e2) {
      // Not configurable here: the own property below hides it.
    }
    if ('serviceWorker' in nav) {
      try {
        Object.defineProperty(nav, 'serviceWorker', { value: undefined, configurable: true, enumerable: false, writable: false });
      } catch (e3) {
        // Left as the browser has it.
      }
    }
  }
})();
