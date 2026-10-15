// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).

// Package measure holds what the measurement commands share.
package measure

import (
	"fmt"
	"os"
	"strings"
)

// RSSPeakMB is the process's resident memory at its largest (VmHWM), in
// MiB; 0 where /proc is not there (outside Linux).
func RSSPeakMB() float64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "VmHWM:") {
			var kb float64
			fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(l, "VmHWM:")), "%f", &kb)
			return kb / 1024
		}
	}
	return 0
}
