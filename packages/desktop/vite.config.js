import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      // @soul-connection/core-logic is an npm-workspace package: it's
      // *symlinked* into node_modules, so its real path resolves outside
      // node_modules/** -- which is all @rollup/plugin-commonjs transforms
      // by default. Without this, the CommonJS `module.exports = {...}` in
      // that package is parsed as plain (non-exporting) ESM, silently
      // dropping every named/default import from it.
      include: [/packages\/core-logic/, /node_modules/],
    },
  },
  optimizeDeps: {
    include: ['@soul-connection/core-logic'],
  },
});
