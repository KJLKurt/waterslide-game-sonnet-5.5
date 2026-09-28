import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Emits dist/sw.js: a tiny service worker that precaches every file of the build (app shell, hashed JS/CSS,
 * lazy chunks, icons, manifest). The cache name is derived from the *scope path* so several PWAs hosted on the
 * same github.io origin can never touch each other's caches, and the worker only handles requests inside its scope.
 */
function precacheServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'splash-rush:sw',
    apply: 'build',
    configResolved(cfg) { outDir = resolve(cfg.root, cfg.build.outDir); },
    closeBundle() {
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(p);
        }
      };
      walk(outDir);
      const list = files
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && f !== '.nojekyll');
      const hash = createHash('sha1');
      for (const f of list.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const precache = ['./', ...list.map((f) => `./${f}`)];
      const tpl = readFileSync(resolve('src/sw-template.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 1)));
      this.warn?.(`sw.js: precaching ${precache.length} files (v${version})`);
    },
  };
}

export default defineConfig({
  // Relative base works from any sub-path (https://user.github.io/<repo>/). CI can still pass BASE_PATH=/<repo>/.
  base: process.env.BASE_PATH || './',
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 1000, assetsInlineLimit: 4096 },
  plugins: [precacheServiceWorker()],
  server: { host: true },
});
