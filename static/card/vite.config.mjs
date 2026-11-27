import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The answer card frame (D59). Forge serves a Custom UI resource from its own folder, so every asset path is
// relative ('./'), and nothing is loaded from anywhere else (the app stays Runs on Atlassian).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  logLevel: 'warn',
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: false,
    // No preload helper: the bundle is one script and one stylesheet.
    modulePreload: false,
  },
});
