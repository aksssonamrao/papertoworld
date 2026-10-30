import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.split('=').slice(1).join('=') || fallback;
const backend = arg('backend', 'webgpu');
const quality = arg('quality', 'high');
const output = path.resolve('artifacts/performance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu',
    ...(process.platform === 'win32' ? ['--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])] });
const report = { note: 'Fixed-camera desktop sampling. These results do not establish mobile performance or a general hardware ceiling.', backend, quality, viewport: [1280, 800], browser: browser.version(), scenes: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { try { localStorage.setItem('pw-intro', '1'); } catch {} });
  const url = new URL(process.env.BASE_URL || 'http://localhost:3000');
  url.search = new URLSearchParams({ debug: '', gpu: backend, quality, pr: '1' });
  await page.goto(url.href);
  await page.waitForFunction(() => !!window.__pw?.generate);
  report.adapter = await page.evaluate(() => {
    const renderer = window.__pw.renderer;
    const info = renderer.backend.device?.adapterInfo;
    if (info) return { backend: 'webgpu', vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
    const gl = renderer.backend.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { backend: 'webgpu-gl', description: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'not exposed' };
  });
  const sample = async label => {
    await page.waitForTimeout(3000);
    const timing = await page.evaluate(() => new Promise(resolve => {
      const intervals = [], started = performance.now(); let previous;
      function frame(now) {
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        if (intervals.length >= 180 || now - started > 20000) {
          const sorted = [...intervals].sort((a, b) => a - b);
          resolve({ frames: intervals.length, medianMs: sorted[Math.floor(sorted.length * 0.5)], p95Ms: sorted[Math.floor(sorted.length * 0.95)], meanMs: intervals.reduce((a, b) => a + b, 0) / intervals.length });
        } else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }));
    const details = await page.evaluate(() => ({ detail: window.__pw.splats.quality, splats: window.__pw.splats.count, generationMs: window.__pw.splats.generationMs, tableBytes: window.__pw.splats.tableBytes, reportedGpuBytes: window.__pw.renderer.info.memory.total }));
    await page.screenshot({ path: path.join(output, `${backend}-${quality}-${label}.png`) });
    report.scenes.push({ label, ...timing, ...details });
    console.log(label, JSON.stringify(report.scenes.at(-1)));
  };
  for (const theme of ['valley', 'forest']) {
    await page.evaluate(async theme => { await window.__pw.generate(theme, 1729); window.__pw.grow(); window.__pw.finishGrowth(); window.__pw.setSkyPreset('12'); window.__pw.settleEnvironment(); }, theme);
    await page.waitForFunction(() => window.__pw.splats.ready && !window.__pw.splats.pending);
    await sample(theme);
    if (theme === 'valley') {
      await page.evaluate(() => window.__pw.enterWalk());
      await page.waitForFunction(() => window.__pw.mode === 'walk');
      await sample('valley-walking');
    }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, `${backend}-${quality}.json`), JSON.stringify(report, null, 2));
}
