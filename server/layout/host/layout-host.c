// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The layout worker's JavaScript engine: quickjs-ng (MIT) as `qjs --std`
// runs it, with two functions more, so the worker can keep sdkjs as
// QuickJS bytecode and skip parsing it (docs/SERVER.md "Getting faster"):
//
//   compileScript(src, out)  parse a script (global code), write its bytecode
//   runBytecode(path)        read bytecode and run it as global code
//
//   layout-host.wasm <script.js> [args...]
//
// The script runs as a classic script, with std, os and bjson global and
// scriptArgs = [script.js, args...], as with `qjs --std`. Built for WASI by
// server/layout/host/build.sh.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs-libc.h"
#include "quickjs.h"

static JSValue throw_io(JSContext* ctx, const char* what, const char* path) {
  return JS_ThrowTypeError(ctx, "%s: %s", what, path ? path : "(null)");
}

static size_t bom(const uint8_t* buf, size_t len) {
  return (len >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF) ? 3 : 0;
}

static JSValue js_compile_script(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv) {
  (void)this_val;
  if (argc < 2) return JS_ThrowTypeError(ctx, "compileScript(src, out)");
  const char* src = JS_ToCString(ctx, argv[0]);
  const char* out = JS_ToCString(ctx, argv[1]);
  JSValue ret = JS_UNDEFINED;
  size_t len = 0;
  uint8_t* buf = src ? js_load_file(ctx, &len, src) : NULL;
  if (!buf) {
    ret = throw_io(ctx, "cannot read", src);
    goto done;
  }
  size_t off = bom(buf, len);
  // JS_Eval wants the source to end with a zero byte (js_load_file adds one).
  JSValue fn = JS_Eval(ctx, (const char*)buf + off, len - off, src, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
  js_free(ctx, buf);
  if (JS_IsException(fn)) {
    ret = fn;
    goto done;
  }
  size_t olen = 0;
  // Without the source text each function keeps (Function.prototype.toString):
  // sdkjs does not read its own source, and it is most of the bytes.
  uint8_t* obuf = JS_WriteObject(ctx, &olen, fn, JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE);
  JS_FreeValue(ctx, fn);
  if (!obuf) {
    ret = JS_EXCEPTION;
    goto done;
  }
  // Written beside and renamed, so a worker starting at the same time
  // never reads half of it.
  char tmp[4096];
  snprintf(tmp, sizeof(tmp), "%s.%d.tmp", out, rand());
  FILE* f = fopen(tmp, "wb");
  if (!f || fwrite(obuf, 1, olen, f) != olen) {
    if (f) fclose(f);
    remove(tmp);
    js_free(ctx, obuf);
    ret = throw_io(ctx, "cannot write", out);
    goto done;
  }
  fclose(f);
  js_free(ctx, obuf);
  if (rename(tmp, out) != 0) {
    remove(tmp);
    ret = throw_io(ctx, "cannot write", out);
    goto done;
  }
  ret = JS_NewInt64(ctx, (int64_t)olen);
done:
  JS_FreeCString(ctx, src);
  JS_FreeCString(ctx, out);
  return ret;
}

static JSValue js_run_bytecode(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv) {
  (void)this_val;
  if (argc < 1) return JS_ThrowTypeError(ctx, "runBytecode(path)");
  const char* path = JS_ToCString(ctx, argv[0]);
  size_t len = 0;
  uint8_t* buf = path ? js_load_file(ctx, &len, path) : NULL;
  if (!buf) {
    JSValue e = throw_io(ctx, "cannot read", path);
    JS_FreeCString(ctx, path);
    return e;
  }
  JS_FreeCString(ctx, path);
  JSValue obj = JS_ReadObject(ctx, buf, len, JS_READ_OBJ_BYTECODE);
  js_free(ctx, buf);
  if (JS_IsException(obj)) return obj;
  return JS_EvalFunction(ctx, obj);
}

static const JSCFunctionListEntry host_funcs[] = {
    JS_CFUNC_DEF("compileScript", 2, js_compile_script),
    JS_CFUNC_DEF("runBytecode", 1, js_run_bytecode),
};

static int eval_code(JSContext* ctx, const char* code, size_t len, const char* name, int flags) {
  JSValue v;
  if ((flags & JS_EVAL_TYPE_MASK) == JS_EVAL_TYPE_MODULE) {
    v = JS_Eval(ctx, code, len, name, flags | JS_EVAL_FLAG_COMPILE_ONLY);
    if (!JS_IsException(v)) v = JS_EvalFunction(ctx, v);
    v = js_std_await(ctx, v);
  } else {
    v = JS_Eval(ctx, code, len, name, flags);
  }
  if (JS_IsException(v)) {
    js_std_dump_error(ctx);
    return -1;
  }
  JS_FreeValue(ctx, v);
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: layout-host <script.js> [args...]\n");
    return 2;
  }
  JSRuntime* rt = JS_NewRuntime();
  if (!rt) return 2;
  js_std_init_handlers(rt);
  JSContext* ctx = JS_NewContext(rt);
  if (!ctx) return 2;
  js_init_module_std(ctx, "qjs:std");
  js_init_module_os(ctx, "qjs:os");
  js_init_module_bjson(ctx, "qjs:bjson");
  JS_SetModuleLoaderFunc2(rt, NULL, js_module_loader, js_module_check_attributes, NULL);
  JS_SetHostPromiseRejectionTracker(rt, js_std_promise_rejection_tracker, NULL);
  js_std_add_helpers(ctx, argc - 1, argv + 1);

  JSValue global = JS_GetGlobalObject(ctx);
  JS_SetPropertyFunctionList(ctx, global, host_funcs, sizeof(host_funcs) / sizeof(host_funcs[0]));
  JS_FreeValue(ctx, global);

  static const char init[] =
      "import * as bjson from 'qjs:bjson';\n"
      "import * as std from 'qjs:std';\n"
      "import * as os from 'qjs:os';\n"
      "globalThis.bjson = bjson;\n"
      "globalThis.std = std;\n"
      "globalThis.os = os;\n";
  int ret = 1;
  if (eval_code(ctx, init, strlen(init), "<init>", JS_EVAL_TYPE_MODULE) == 0) {
    size_t len = 0;
    uint8_t* buf = js_load_file(ctx, &len, argv[1]);
    if (!buf) {
      perror(argv[1]);
    } else {
      size_t off = bom(buf, len);
      ret = eval_code(ctx, (const char*)buf + off, len - off, argv[1], JS_EVAL_TYPE_GLOBAL) ? 1 : 0;
      js_free(ctx, buf);
      if (ret == 0 && js_std_loop(ctx)) ret = 1;
    }
  }
  js_std_free_handlers(rt);
  JS_FreeContext(ctx);
  JS_FreeRuntime(rt);
  return ret;
}
