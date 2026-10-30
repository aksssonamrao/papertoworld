import path from 'node:path';
import { root } from './build.mjs';
process.env.PAPERWORLD_STATIC_ROOT = path.join(root, 'dist');
await import('../serve.mjs');
