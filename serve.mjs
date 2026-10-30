// Minimal static server for local development: node serve.mjs [port]
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.env.PAPERWORLD_STATIC_ROOT || 'dist');
const port = Number(process.argv[2] || process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
};

// fly bridge: with FLY_OUT set, the page's ?fly=export mode can save world exports into that folder (and nowhere else)
const flyOut = process.env.FLY_OUT ? resolve(process.env.FLY_OUT) : null;
async function flySave(req, res) {
  const rel = String(req.headers['x-fly-file'] || '');
  const file = normalize(join(flyOut, rel));
  if (!/^[\w-]+\/[\w.-]+$/.test(rel) || !file.startsWith(flyOut + sep)) { res.writeHead(400).end(); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.concat(chunks));
  console.log(`fly bridge: saved ${rel}`);
  res.writeHead(204).end();
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__fly/save') {
    if (!flyOut) { res.writeHead(404).end(); return; }
    try { await flySave(req, res); } catch (e) { console.error(e); res.writeHead(500).end(); }
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, urlPath));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    // cleanUrls: /foo -> /foo.html
    file += '.html';
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`PaperToWorld running at http://localhost:${port}`));
