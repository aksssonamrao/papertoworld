import { buildApp } from './build.mjs';
import { watch } from 'node:fs';
import path from 'node:path';
import { root } from './build.mjs';

process.env.PAPERWORLD_STATIC_ROOT = await buildApp({ clean: false });
await import('../serve.mjs');
let timer, rebuilding = false, again = false;
async function rebuild() {
  if (rebuilding) { again = true; return; }
  rebuilding = true;
  try { await buildApp({ clean: false }); console.log('World rebuilt. Refresh to see the changes.'); }
  catch (error) { console.error(error); }
  finally { rebuilding = false; if (again) { again = false; rebuild(); } }
}
watch(path.join(root, 'papertoworld'), { recursive: true }, (_, name) => {
  if (!name || name.startsWith('vendor') || name.startsWith('models')) return;
  clearTimeout(timer); timer = setTimeout(rebuild, 200);
});
