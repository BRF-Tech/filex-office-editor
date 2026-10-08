// SPDX-License-Identifier: AGPL-3.0-or-later
// The unit tests of the bridge, the lock rules, the socket.io stand-in and
// the x2t driver. None of them needs a DOM: the code under test touches no
// document and no network, so the tests run in Node.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
