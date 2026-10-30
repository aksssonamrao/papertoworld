import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildApp({ clean = true } = {}) {
  const source = path.join(root, 'papertoworld');
  const destination = path.join(root, 'dist');
  await mkdir(path.join(destination, 'assets'), { recursive: true });
  for (const name of ['models', 'vendor', 'classic.html', 'og-image.png']) {
    await cp(path.join(source, name), path.join(destination, name), { recursive: true });
  }
  // papertoworld/demos (the renderer comparison) is local-only and never ships.
  // Serve it locally with: PAPERWORLD_STATIC_ROOT=papertoworld node serve.mjs
  await rm(path.join(destination, 'demos'), { recursive: true, force: true });
  const common = {
    bundle: true, format: 'esm', target: 'es2022', minify: true,
    sourcemap: process.env.PAPERWORLD_SOURCEMAPS === '1' ? 'external' : false,
    metafile: true, outdir: path.join(destination, 'assets'),
    entryNames: '[name]-[hash]', logLevel: 'warning',
  };
  // Resolve only the bare Three import to the same module as three/webgpu.
  // Addon and TSL entry points retain their normal package exports.
  common.plugins = [{ name: 'one-three-runtime', setup(builder) {
    builder.onResolve({ filter: /^three$/ }, () => ({ path: path.join(root, 'node_modules/three/build/three.webgpu.js') }));
  } }];
  const worker = await build({ ...common, entryPoints: { 'world-worker': path.join(source, 'src/render/splats/generate-worker.js') } });
  const workerPath = Object.keys(worker.metafile.outputs).find(p => p.endsWith('.js'));
  const app = await build({ ...common, entryPoints: { app: path.join(source, 'src/app.js') },
    define: { __WORLD_WORKER_URL__: JSON.stringify('/assets/' + path.basename(workerPath)) },
  });
  const appPath = Object.keys(app.metafile.outputs).find(p => p.endsWith('.js'));
  const html = (await readFile(path.join(source, 'index.html'), 'utf8'))
    .replace('src="src/app.js"', `src="/assets/${path.basename(appPath)}"`);
  await writeFile(path.join(destination, 'index.html'), html);
  await cp(path.join(source, 'vercel.json'), path.join(destination, 'vercel.json'));
  await writeFile(path.join(destination, 'build.json'), JSON.stringify({ renderer: 'radix-0.0.1', three: '0.186.0', app: path.basename(appPath), worker: path.basename(workerPath) }, null, 2));
  if (clean) {
    const keep = new Set([path.basename(appPath), path.basename(workerPath)]);
    if (common.sourcemap) for (const file of [...keep]) keep.add(file + '.map');
    for (const file of await readdir(path.join(destination, 'assets'))) {
      if (!keep.has(file)) await rm(path.join(destination, 'assets', file));
    }
  }
  return destination;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log('Built', await buildApp());
