import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Version like the iOS app: base + number of commits touching the web app.
let commits = '0';
try { commits = execSync('git rev-list --count HEAD -- .', { cwd: __dirname }).toString().trim(); } catch { /* not a git checkout */ }

const version = `1.0.${commits}`;

export default defineConfig({
  base: './', // works under https://<user>.github.io/<repo>/ without knowing the repo name
  plugins: [preact(), {
    // public/sw.js is copied verbatim, so the version goes in after the bundle is written.
    name: 'sw-version',
    closeBundle() {
      const f = join(__dirname, 'dist', 'sw.js');
      try { writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__APP_VERSION__', version)); } catch { /* no build output (dev) */ }
    },
  }],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: 'safari16' },
});
