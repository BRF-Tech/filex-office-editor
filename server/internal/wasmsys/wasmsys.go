// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// Package wasmsys is what every WebAssembly module this repository runs
// gets from the system it runs on.
package wasmsys

import (
	"crypto/rand"

	"github.com/tetratelabs/wazero"
)

// ModuleConfig is wazero's module configuration with the system's clocks
// and the operating system's random numbers. wazero's own defaults are
// deterministic - a fake clock and, for WASI's random_get, the same bytes
// every run - and x2t reads random_get (/dev/urandom, scripts/x2t/server)
// for the salt and the key of a document it protects with a password: with
// the default, every protected document got the same ones. Each module
// adds its name, arguments, files and streams to this.
func ModuleConfig() wazero.ModuleConfig {
	return wazero.NewModuleConfig().
		WithSysWalltime().
		WithSysNanotime().
		WithRandSource(rand.Reader)
}
