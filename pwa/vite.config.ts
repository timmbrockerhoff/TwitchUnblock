import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';

// Version like the iOS app: base + number of commits touching the web app.
let commits = '0';
try { commits = execSync('git rev-list --count HEAD -- .', { cwd: __dirname }).toString().trim(); } catch { /* not a git checkout */ }

export default defineConfig({
  base: './', // works under https://<user>.github.io/<repo>/ without knowing the repo name
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(`1.0.${commits}`) },
  build: { target: 'safari16' },
});
