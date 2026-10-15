// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Files for the server build of x2t (scripts/x2t/steps.sh, x2t_server),
// through WASI. emscripten's STANDALONE_WASM libc opens no file but the
// standard streams: its system calls are weak stand-ins that answer EPERM or
// ENOSYS (system/lib/standalone/standalone.c, "TODO: full file support for
// WASI"). The definitions here take their place and do what the page's
// emscripten JavaScript (MEMFS) does for x2t, over the directories the host
// preopens (a Document Server's x2t works in a directory of its own; filex
// mounts one per conversion): the 18 calls the page's build imports
// (open, stat and friends, directories, getcwd/chdir, truncate, utimensat)
// and mmap of a file. read, write, seek and close are WASI's already.
//
// Paths: an absolute path is looked up among the preopened directories
// (the longest that holds it); a relative one is taken from the working
// directory (chdir), "/" at the start. No symbolic links.

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <wasi/api.h>

#include <emscripten/heap.h>
// The prototypes the calls below must match (emscripten's musl,
// arch/emscripten/syscall_arch.h; steps.sh puts it on the include path).
#include <syscall_arch.h>

void* emscripten_builtin_memalign(size_t alignment, size_t size);
void emscripten_builtin_free(void* ptr);

#define MAX_PREOPENS 16
#define MAX_PATH 4096
#define MAX_DIR_FDS 1024

struct preopen {
  __wasi_fd_t fd;
  char path[256];
  size_t len;
};

static struct preopen preopens[MAX_PREOPENS];
static int npreopens = -1;
static char cwd[MAX_PATH] = "/";
static __wasi_dircookie_t dir_cookie[MAX_DIR_FDS];

static void find_preopens(void) {
  if (npreopens >= 0) return;
  npreopens = 0;
  for (__wasi_fd_t fd = 3; npreopens < MAX_PREOPENS; fd++) {
    __wasi_prestat_t st;
    if (__wasi_fd_prestat_get(fd, &st) != 0) break;
    if (st.pr_type != __WASI_PREOPENTYPE_DIR || st.u.dir.pr_name_len >= sizeof(preopens[0].path)) continue;
    struct preopen* p = &preopens[npreopens];
    if (__wasi_fd_prestat_dir_name(fd, (uint8_t*)p->path, st.u.dir.pr_name_len) != 0) continue;
    p->path[st.u.dir.pr_name_len] = 0;
    p->len = st.u.dir.pr_name_len;
    while (p->len > 1 && p->path[p->len - 1] == '/') p->path[--p->len] = 0;
    p->fd = fd;
    npreopens++;
  }
}

// An absolute, clean path ("/a/b", no ".", "..", "//") from `path` taken
// from `base`.
static int clean_path(const char* base, const char* path, char* out) {
  char tmp[MAX_PATH];
  size_t n = 0;
  if (path[0] != '/') {
    size_t bl = strlen(base);
    if (bl + 1 >= sizeof(tmp)) return -ENAMETOOLONG;
    memcpy(tmp, base, bl);
    n = bl;
    tmp[n++] = '/';
  }
  size_t pl = strlen(path);
  if (n + pl + 1 >= sizeof(tmp)) return -ENAMETOOLONG;
  memcpy(tmp + n, path, pl + 1);
  size_t o = 0;
  const char* s = tmp;
  while (*s) {
    while (*s == '/') s++;
    if (!*s) break;
    const char* e = s;
    while (*e && *e != '/') e++;
    size_t len = (size_t)(e - s);
    if (len == 1 && s[0] == '.') {
    } else if (len == 2 && s[0] == '.' && s[1] == '.') {
      while (o > 0 && out[o - 1] != '/') o--;
      if (o > 0) o--;
    } else {
      if (o + 1 + len + 1 >= MAX_PATH) return -ENAMETOOLONG;
      out[o++] = '/';
      memcpy(out + o, s, len);
      o += len;
    }
    s = e;
  }
  if (o == 0) out[o++] = '/';
  out[o] = 0;
  return 0;
}

// The preopened directory that holds `path` and the path inside it.
static int resolve(int dirfd, const char* path, __wasi_fd_t* fd, const char** rel, char* buf) {
  if (!path || !*path) return -ENOENT;
  if (path[0] != '/' && dirfd != AT_FDCWD) {
    *fd = (__wasi_fd_t)dirfd;
    *rel = path;
    return 0;
  }
  int r = clean_path(cwd, path, buf);
  if (r < 0) return r;
  find_preopens();
  int best = -1;
  size_t bestlen = 0;
  for (int i = 0; i < npreopens; i++) {
    struct preopen* p = &preopens[i];
    bool root = p->len == 1 && p->path[0] == '/';
    if (root || (strncmp(buf, p->path, p->len) == 0 && (buf[p->len] == '/' || buf[p->len] == 0))) {
      if (best < 0 || p->len > bestlen) {
        best = i;
        bestlen = p->len;
      }
    }
  }
  if (best < 0) return -ENOENT;
  const char* r2 = buf + ((preopens[best].len == 1) ? 0 : preopens[best].len);
  while (*r2 == '/') r2++;
  *fd = preopens[best].fd;
  *rel = *r2 ? r2 : ".";
  return 0;
}

static void fill_stat(const __wasi_filestat_t* f, struct stat* st) {
  memset(st, 0, sizeof(*st));
  st->st_dev = f->dev;
  st->st_ino = f->ino;
  st->st_nlink = f->nlink;
  st->st_size = (off_t)f->size;
  st->st_blksize = 4096;
  st->st_blocks = (blkcnt_t)((f->size + 511) / 512);
  switch (f->filetype) {
    case __WASI_FILETYPE_DIRECTORY: st->st_mode = S_IFDIR | 0755; break;
    case __WASI_FILETYPE_SYMBOLIC_LINK: st->st_mode = S_IFLNK | 0777; break;
    case __WASI_FILETYPE_CHARACTER_DEVICE: st->st_mode = S_IFCHR | 0666; break;
    case __WASI_FILETYPE_BLOCK_DEVICE: st->st_mode = S_IFBLK | 0666; break;
    default: st->st_mode = S_IFREG | 0644; break;
  }
  st->st_atim.tv_sec = (time_t)(f->atim / 1000000000ull);
  st->st_atim.tv_nsec = (long)(f->atim % 1000000000ull);
  st->st_mtim.tv_sec = (time_t)(f->mtim / 1000000000ull);
  st->st_mtim.tv_nsec = (long)(f->mtim % 1000000000ull);
  st->st_ctim.tv_sec = (time_t)(f->ctim / 1000000000ull);
  st->st_ctim.tv_nsec = (long)(f->ctim % 1000000000ull);
}

static int path_stat(int dirfd, const char* path, struct stat* st, bool follow) {
  char buf[MAX_PATH];
  __wasi_fd_t fd;
  const char* rel;
  int r = resolve(dirfd, path, &fd, &rel, buf);
  if (r < 0) return r;
  __wasi_filestat_t f;
  __wasi_errno_t e = __wasi_path_filestat_get(fd, follow ? __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW : 0, rel, strlen(rel), &f);
  if (e) return -e;
  fill_stat(&f, st);
  return 0;
}

int __syscall_openat(int dirfd, intptr_t path, int flags, ...) {
  char buf[MAX_PATH];
  __wasi_fd_t base;
  const char* rel;
  int r = resolve(dirfd, (const char*)path, &base, &rel, buf);
  if (r < 0) return r;
  __wasi_oflags_t of = 0;
  if (flags & O_CREAT) of |= __WASI_OFLAGS_CREAT;
  if (flags & O_EXCL) of |= __WASI_OFLAGS_EXCL;
  if (flags & O_TRUNC) of |= __WASI_OFLAGS_TRUNC;
  if (flags & O_DIRECTORY) of |= __WASI_OFLAGS_DIRECTORY;
  __wasi_fdflags_t ff = 0;
  if (flags & O_APPEND) ff |= __WASI_FDFLAGS_APPEND;
  if (flags & O_NONBLOCK) ff |= __WASI_FDFLAGS_NONBLOCK;
  // The rights say how the file is opened (wazero opens a directory asked
  // for writing as EISDIR), as wasi-libc's open does.
  const __wasi_rights_t write = __WASI_RIGHTS_FD_WRITE | __WASI_RIGHTS_FD_ALLOCATE | __WASI_RIGHTS_FD_FILESTAT_SET_SIZE |
                                __WASI_RIGHTS_FD_DATASYNC | __WASI_RIGHTS_FD_SYNC;
  __wasi_rights_t rights = (__wasi_rights_t)-1;
  if ((flags & O_ACCMODE) == O_RDONLY) rights &= ~write;
  if ((flags & O_ACCMODE) == O_WRONLY) rights &= ~(__wasi_rights_t)(__WASI_RIGHTS_FD_READ | __WASI_RIGHTS_FD_READDIR);
  __wasi_fd_t fd;
  __wasi_errno_t e = __wasi_path_open(base, (flags & O_NOFOLLOW) ? 0 : __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW, rel, strlen(rel), of, rights, rights, ff, &fd);
  if (e) return -e;
  if (fd < MAX_DIR_FDS) dir_cookie[fd] = 0;
  return (int)fd;
}

int __syscall_fstat64(int fd, intptr_t buf) {
  __wasi_filestat_t f;
  __wasi_errno_t e = __wasi_fd_filestat_get((__wasi_fd_t)fd, &f);
  if (e) return -e;
  fill_stat(&f, (struct stat*)buf);
  return 0;
}

int __syscall_stat64(intptr_t path, intptr_t buf) { return path_stat(AT_FDCWD, (const char*)path, (struct stat*)buf, true); }

int __syscall_lstat64(intptr_t path, intptr_t buf) { return path_stat(AT_FDCWD, (const char*)path, (struct stat*)buf, false); }

int __syscall_newfstatat(int dirfd, intptr_t path, intptr_t buf, int flags) {
  if ((flags & AT_EMPTY_PATH) && (!path || !*(const char*)path)) return __syscall_fstat64(dirfd, buf);
  return path_stat(dirfd, (const char*)path, (struct stat*)buf, !(flags & AT_SYMLINK_NOFOLLOW));
}

int __syscall_mkdirat(int dirfd, intptr_t path, int mode) {
  (void)mode;
  char buf[MAX_PATH];
  __wasi_fd_t fd;
  const char* rel;
  int r = resolve(dirfd, (const char*)path, &fd, &rel, buf);
  if (r < 0) return r;
  return -(int)__wasi_path_create_directory(fd, rel, strlen(rel));
}

int __syscall_unlinkat(int dirfd, intptr_t path, int flags) {
  char buf[MAX_PATH];
  __wasi_fd_t fd;
  const char* rel;
  int r = resolve(dirfd, (const char*)path, &fd, &rel, buf);
  if (r < 0) return r;
  if (flags & AT_REMOVEDIR) return -(int)__wasi_path_remove_directory(fd, rel, strlen(rel));
  return -(int)__wasi_path_unlink_file(fd, rel, strlen(rel));
}

int __syscall_rmdir(intptr_t path) { return __syscall_unlinkat(AT_FDCWD, path, AT_REMOVEDIR); }

int __syscall_renameat(int olddirfd, intptr_t oldpath, int newdirfd, intptr_t newpath) {
  char b1[MAX_PATH], b2[MAX_PATH];
  __wasi_fd_t f1, f2;
  const char *r1, *r2;
  int r = resolve(olddirfd, (const char*)oldpath, &f1, &r1, b1);
  if (r < 0) return r;
  r = resolve(newdirfd, (const char*)newpath, &f2, &r2, b2);
  if (r < 0) return r;
  return -(int)__wasi_path_rename(f1, r1, strlen(r1), f2, r2, strlen(r2));
}

int __syscall_getdents64(int fd, intptr_t dirp, size_t count) {
  if (fd < 0 || fd >= MAX_DIR_FDS) return -EBADF;
  uint8_t raw[4096];
  __wasi_size_t used = 0;
  __wasi_errno_t e = __wasi_fd_readdir((__wasi_fd_t)fd, raw, sizeof(raw), dir_cookie[fd], &used);
  if (e) return -e;
  size_t in = 0, out = 0;
  while (in + sizeof(__wasi_dirent_t) <= used) {
    __wasi_dirent_t d;
    memcpy(&d, raw + in, sizeof(d));
    if (in + sizeof(d) + d.d_namlen > used) break; // cut off: the next call reads it again
    size_t reclen = (offsetof(struct dirent, d_name) + d.d_namlen + 1 + 7) & ~(size_t)7;
    if (out + reclen > count) {
      if (out == 0) return -EINVAL;
      break;
    }
    struct dirent* de = (struct dirent*)(dirp + out);
    de->d_ino = d.d_ino;
    de->d_off = (off_t)d.d_next;
    de->d_reclen = (unsigned short)reclen;
    switch (d.d_type) {
      case __WASI_FILETYPE_DIRECTORY: de->d_type = DT_DIR; break;
      case __WASI_FILETYPE_REGULAR_FILE: de->d_type = DT_REG; break;
      case __WASI_FILETYPE_SYMBOLIC_LINK: de->d_type = DT_LNK; break;
      default: de->d_type = DT_UNKNOWN; break;
    }
    memcpy(de->d_name, raw + in + sizeof(d), d.d_namlen);
    de->d_name[d.d_namlen] = 0;
    out += reclen;
    in += sizeof(d) + d.d_namlen;
    dir_cookie[fd] = d.d_next;
  }
  return (int)out;
}

int __syscall_fcntl64(int fd, int cmd, ...) {
  va_list ap;
  va_start(ap, cmd);
  int arg = va_arg(ap, int);
  va_end(ap);
  switch (cmd) {
    case F_GETFD:
    case F_SETFD:
      return 0;
    case F_GETFL: {
      __wasi_fdstat_t st;
      __wasi_errno_t e = __wasi_fd_fdstat_get((__wasi_fd_t)fd, &st);
      if (e) return -e;
      int fl = O_RDWR;
      if (st.fs_flags & __WASI_FDFLAGS_APPEND) fl |= O_APPEND;
      if (st.fs_flags & __WASI_FDFLAGS_NONBLOCK) fl |= O_NONBLOCK;
      return fl;
    }
    case F_SETFL: {
      __wasi_fdflags_t ff = 0;
      if (arg & O_APPEND) ff |= __WASI_FDFLAGS_APPEND;
      if (arg & O_NONBLOCK) ff |= __WASI_FDFLAGS_NONBLOCK;
      return -(int)__wasi_fd_fdstat_set_flags((__wasi_fd_t)fd, ff);
    }
    default:
      return -EINVAL;
  }
}

int __syscall_ioctl(int fd, int op, ...) {
  (void)fd;
  (void)op;
  return -ENOTTY;
}

int __syscall_getcwd(intptr_t buf, size_t size) {
  size_t n = strlen(cwd) + 1;
  if (size < n) return -ERANGE;
  memcpy((char*)buf, cwd, n);
  return (int)n;
}

int __syscall_chdir(intptr_t path) {
  char abs[MAX_PATH];
  int r = clean_path(cwd, (const char*)path, abs);
  if (r < 0) return r;
  struct stat st;
  r = path_stat(AT_FDCWD, abs, &st, true);
  if (r < 0) return r;
  if (!S_ISDIR(st.st_mode)) return -ENOTDIR;
  strcpy(cwd, abs);
  return 0;
}

int __syscall_truncate64(intptr_t path, off_t length) {
  int fd = __syscall_openat(AT_FDCWD, path, O_WRONLY);
  if (fd < 0) return fd;
  __wasi_errno_t e = __wasi_fd_filestat_set_size((__wasi_fd_t)fd, (__wasi_filesize_t)length);
  __wasi_errno_t c = __wasi_fd_close((__wasi_fd_t)fd);
  return -(int)(e ? e : c);
}

int __syscall_ftruncate64(int fd, off_t length) { return -(int)__wasi_fd_filestat_set_size((__wasi_fd_t)fd, (__wasi_filesize_t)length); }

int __syscall_utimensat(int dirfd, intptr_t path, intptr_t times, int flags) {
  (void)dirfd;
  (void)path;
  (void)times;
  (void)flags;
  return 0;
}

int __syscall_readlinkat(int dirfd, intptr_t path, intptr_t buf, size_t bufsize) {
  (void)dirfd;
  (void)path;
  (void)buf;
  (void)bufsize;
  return -EINVAL;
}

int __syscall_faccessat(int dirfd, intptr_t path, int amode, int flags) {
  (void)amode;
  struct stat st;
  return path_stat(dirfd, (const char*)path, &st, !(flags & AT_SYMLINK_NOFOLLOW));
}

int __syscall_dup(int fd) {
  (void)fd;
  return -ENOSYS;
}

int __syscall_dup3(int fd, int fd2, int flags) {
  (void)flags;
  if (fd == fd2) return -EINVAL;
  return -(int)__wasi_fd_renumber((__wasi_fd_t)fd, (__wasi_fd_t)fd2);
}

int __syscall_pipe(intptr_t fds) {
  (void)fds;
  return -ENOSYS;
}

// mmap of a file: a copy in the heap (emscripten's mmap frees it at
// munmap), written back at munmap for a shared, writable mapping.
int _mmap_js(size_t length, int prot, int flags, int fd, off_t offset, int* allocated, void** addr) {
  (void)prot;
  (void)flags;
  void* p = emscripten_builtin_memalign(16, length ? length : 1);
  if (!p) return -ENOMEM;
  memset(p, 0, length);
  size_t done = 0;
  while (done < length) {
    __wasi_iovec_t iov = {(uint8_t*)p + done, length - done};
    __wasi_size_t n = 0;
    __wasi_errno_t e = __wasi_fd_pread((__wasi_fd_t)fd, &iov, 1, (__wasi_filesize_t)(offset + (off_t)done), &n);
    if (e) {
      emscripten_builtin_free(p);
      return -e;
    }
    if (n == 0) break;
    done += n;
  }
  *allocated = 1;
  *addr = p;
  return 0;
}

int _munmap_js(intptr_t addr, size_t length, int prot, int flags, int fd, off_t offset) {
  if ((flags & MAP_SHARED) && (prot & PROT_WRITE)) {
    size_t done = 0;
    while (done < length) {
      __wasi_ciovec_t iov = {(const uint8_t*)addr + done, length - done};
      __wasi_size_t n = 0;
      __wasi_errno_t e = __wasi_fd_pwrite((__wasi_fd_t)fd, &iov, 1, (__wasi_filesize_t)(offset + (off_t)done), &n);
      if (e) return -e;
      if (n == 0) break;
      done += n;
    }
  }
  return 0;
}

int _msync_js(intptr_t addr, size_t length, int prot, int flags, int fd, off_t offset) { return _munmap_js(addr, length, prot, flags, fd, offset); }
