import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApp, root } from './build.mjs';

const dist = await buildApp();
const output = path.join(root, '.vercel/output');
// Only replace our generated Build Output API directory. Project association
// and Vercel environment/settings files beside it remain untouched.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(dist, path.join(output, 'static'), { recursive: true });
await rm(path.join(output, 'static/vercel.json'));
await writeFile(path.join(output, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/vendor/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/(.*)', headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }, continue: true },
    { handle: 'filesystem' },
    { src: '/classic', dest: '/classic.html' },
  ],
}, null, 2));
console.log('Prepared Vercel Build Output API artifact:', output);
console.log('After linking this checkout to the existing project, deploy a preview with: vercel deploy --prebuilt');
