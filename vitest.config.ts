import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Mirror the tsconfig `paths` aliases here (house rule: aliases must resolve
// identically in the type-checker and the test runner). NO `@/*`, NO `../..`.
//
// Source imports carry `.js` extensions (NodeNext correctness; `tsc-alias`
// rewrites them at build). In tests we resolve `@council/<name>.js` back to the
// `.ts` source, so the regex alias strips the alias prefix + the `.js` suffix.
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  test: {
    // globals OFF — tests import { describe, it, expect } explicitly.
    globals: false,
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: [
      { find: /^@council\/(.*)\.js$/, replacement: `${srcDir}/$1.ts` },
      { find: /^@council\/(.*)$/, replacement: `${srcDir}/$1` },
    ],
  },
});
