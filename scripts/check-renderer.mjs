import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Exercise the shipped app and its real renderer; this is functional coverage,
// not a performance benchmark. Use representative hardware for frame budgets.
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:3000');
const requestedBackend = arg('backend', 'all');
assert(['all', 'webgpu', 'webgpu-gl'].includes(requestedBackend), 'Use --backend=all|webgpu|webgpu-gl');
const backends = requestedBackend === 'all' ? ['webgpu-gl', 'webgpu'] : [requestedBackend];
const allThemes = ['valley', 'islands', 'lake', 'oasis', 'coast', 'farm', 'forest', 'peaks'];
const themes = arg('themes', allThemes.join(',')).split(',');
assert(themes.every(t => allThemes.includes(t)), 'Unknown theme');
const timeout = Number(process.env.RENDERER_TEST_TIMEOUT || 180000);
const output = resolve(process.env.RENDERER_TEST_OUTPUT || 'artifacts/renderer');
await mkdir(output, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  baseURL: base.href,
  note: 'Browser interaction and rendering checks. Headless/software results do not establish device performance.',
  backendResults: [],
};

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || undefined,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-watchdog',
    '--enable-unsafe-webgpu', ...(process.platform==='win32' ? ['--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
    ...JSON.parse(process.env.BROWSER_ARGS || '[]'),
  ],
});

async function bounded(label, operation, limit = timeout) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${limit} ms`)), limit); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function evaluate(page, callback, argument) {
  return bounded('Browser evaluation', page.evaluate(callback, argument));
}

const snapshotHash = snapshot => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

async function captureDownload(page, backend, label, trigger) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: Math.min(timeout, 45000) }),
    bounded(`${label} action`, trigger()),
  ]);
  assert.equal(await bounded(`${label} download`, download.failure()), null, `${label}: browser download failed`);
  const extension = extname(download.suggestedFilename()).toLowerCase();
  const file = `${backend}-${label}${extension}`;
  const path = resolve(output, file);
  await bounded(`${label} save`, download.saveAs(path));
  const info = await stat(path);
  assert(info.size > 1000, `${label}: exported file is unexpectedly small`);
  const bytes = await readFile(path);
  if (label === 'postcard') {
    assert.equal(extension, '.png');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Postcard is not a PNG');
    assert(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, 'Postcard has invalid dimensions');
  } else {
    assert(['.mp4', '.webm'].includes(extension), 'Unexpected video container');
    assert(extension === '.webm'
      ? bytes.subarray(0, 4).toString('hex') === '1a45dfa3'
      : bytes.subarray(4, 8).toString() === 'ftyp', 'Video has an invalid container signature');
  }
  return { file, bytes: info.size, suggestedFilename: download.suggestedFilename() };
}

function attachDiagnostics(page) {
  const diagnostics = { errors: [], warnings: [], assets: [] };
  page.on('pageerror', error => diagnostics.errors.push(String(error.stack || error).slice(0, 1800)));
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') diagnostics.errors.push(text.slice(0, 1800));
    if (msg.type() === 'warning') diagnostics.warnings.push(text.slice(0, 1200));
  });
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === base.origin)
      diagnostics.assets.push({ url: response.url(), status: response.status() });
  });
  return diagnostics;
}

async function settle(page) {
  await page.waitForFunction(() => {
    const p = window.__pw;
    if (p?.splats?.error) throw new Error(p.splats.error);
    return p && p.W && p.mode === 'view' && p.splats?.ready && !p.splats?.pending;
  }, null, { timeout });
  // Let the renderer submit and present the new scene before screenshots.
  await evaluate(page, () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function generate(page, theme, seed = 1729) {
  await evaluate(page, async ({ theme, seed }) => {
    const p = window.__pw;
    if (p.mode !== 'draw') p.goPaper();
    await p.generate(theme, seed);
    await p.grow();
    await p.finishGrowth();
  }, { theme, seed });
  await settle(page);
}

async function screenshot(page, name) {
  const file = `${name}.png`;
  const bytes = await page.screenshot({ path: resolve(output, file), timeout: Math.min(timeout, 30000) });
  assert(bytes.length > 5000, `${name}: unexpectedly empty screenshot`);
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function state(page) {
  return evaluate(page, () => {
    const p = window.__pw;
    return {
      mode: p.mode,
      backend: p.renderer.backend.isWebGPUBackend ? 'webgpu' : p.renderer.backend.isWebGLBackend ? 'webgpu-gl' : 'unknown',
      splats: { ...p.splats },
      resources: p.resources ? { ...p.resources } : null,
      trees: p.W?.trees?.length || 0,
      houses: p.W?.houses?.length || 0,
      canvas: { width: p.renderer.domElement.width, height: p.renderer.domElement.height },
    };
  });
}

try {
  for (const backend of backends) {
    const result = { requestedBackend: backend, themes: [], checks: [], diagnostics: null };
    report.backendResults.push(result);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
    await context.addInitScript(() => { try { localStorage.setItem('pw-intro', '1'); } catch {} });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const diagnostics = attachDiagnostics(page);
    result.diagnostics = diagnostics;
    try {
      const url = new URL(base);
      url.search = new URLSearchParams({ debug: '', gpu: backend, quality: 'low', pr: '1' }).toString();
      console.log(`Checking ${backend}: boot`);
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForFunction(() => typeof window.__pw?.generate === 'function', null, { timeout });
      const actual = await state(page);
      result.actualBackend = actual.backend;
      assert.equal(actual.backend, backend, `Requested ${backend}, actually running ${actual.backend}`);
      result.screenshots = [await screenshot(page, `${backend}-paper`)];

      console.log(`Checking ${backend}: ink pointer stroke and campfire stamp`);
      await page.locator('#inkPots [data-t="1"]').click();
      await page.mouse.move(500, 220);
      await page.mouse.down();
      await page.mouse.move(720, 300, { steps: 16 });
      await page.mouse.up();
      await page.locator('#trayTabs [data-v="stamp"]').click();
      await page.locator('#stampPots [data-k="campfire"]').click();
      await page.mouse.click(640, 270);
      await page.locator('#grow').click();
      await page.waitForFunction(() => Boolean(window.__pw.W));
      await evaluate(page, () => window.__pw.finishGrowth());
      await settle(page);
      const painted = await evaluate(page, () => ({
        forest: [...window.__pw.W.type].includes(1),
        stamped: window.__pw.W.props.some(prop => prop.k === 'campfire'),
      }));
      assert(painted.forest, 'Pointer stroke did not create forest');
      assert(painted.stamped, 'Pointer stamp did not create a campfire');
      result.checks.push('pointer painting and stamp placement');
      await page.locator('#trayTabs [data-v="ink"]').dispatchEvent('click');

      let valleySnapshot;
      for (const theme of themes) {
        console.log(`Checking ${backend}: ${theme}`);
        await generate(page, theme);
        const current = await state(page);
        assert(current.splats.count > 0, `${theme}: no procedural splats`);
        assert(current.canvas.width > 0 && current.canvas.height > 0);
        result.themes.push({ theme, ...current });
        result.screenshots.push(await screenshot(page, `${backend}-${theme}`));
        if (theme === 'valley') valleySnapshot = await evaluate(page, () => window.__pw.snapshot());
      }

      console.log(`Checking ${backend}: regeneration, seasons, walking and sharing`);
      // Returning to the same deterministic fixture must preserve the world.
      await generate(page, 'valley');
      const regenerated = await evaluate(page, () => window.__pw.snapshot());
      if (valleySnapshot !== undefined) assert.equal(snapshotHash(regenerated), snapshotHash(valleySnapshot), 'Regenerated valley layout changed');
      result.checks.push('deterministic regeneration');

      console.log(`Checking ${backend}: rapid detail changes and stale-worker retirement`);
      const originalDetail = await state(page);
      await evaluate(page, () => {
        window.__pw.setQuality('medium');
        window.__pw.setQuality('low');
      });
      await settle(page);
      const changedDetail = await state(page);
      assert.equal(changedDetail.splats.quality, 'low', 'A stale worker replaced the selected detail level');
      assert.equal(changedDetail.splats.count, originalDetail.splats.count, 'Rapid detail changes changed the final splat count');
      assert.equal(snapshotHash(await evaluate(page, () => window.__pw.snapshot())), snapshotHash(regenerated), 'Detail changes moved world landmarks');
      result.checks.push('quality changes cancel stale generation and preserve landmarks');

      for (const season of ['spring', 'summer', 'autumn', 'winter']) {
        await evaluate(page, season => window.__pw.setSeason(season), season);
        await evaluate(page, () => new Promise(resolve => requestAnimationFrame(resolve)));
      }
      await evaluate(page, () => { window.__pw.setSeason('summer'); window.__pw.setSkyPreset('23'); window.__pw.setWx(1); window.__pw.settleEnvironment?.(); });
      result.screenshots.push(await screenshot(page, `${backend}-night-rain`));
      await evaluate(page, () => { window.__pw.setSkyPreset('12'); window.__pw.setWx(0); window.__pw.settleEnvironment?.(); });
      result.checks.push('four seasons, night, noon and rain');

      console.log(`Checking ${backend}: postcard and recorded video downloads`);
      result.downloads = [];
      result.downloads.push(await captureDownload(page, backend, 'postcard', async () => {
        await page.locator('#tMore').click();
        await page.locator('#mPhoto').click();
      }));
      result.checks.push('postcard download with PNG signature and dimensions');
      result.downloads.push(await captureDownload(page, backend, 'video', async () => {
        await page.locator('#tMore').click();
        await page.locator('#mRec').click();
        await page.locator('#tRec.on').waitFor({ state: 'attached' });
        await new Promise(resolve => setTimeout(resolve, 1200));
        await page.locator('#tMore').click();
        assert.equal((await page.locator('#mRecL').textContent()).trim(), 'Stop recording');
        await page.locator('#mRec').click();
      }));
      result.checks.push('recorded video download with valid container signature');

      console.log(`Checking ${backend}: walking`);
      await evaluate(page, () => window.__pw.enterWalk());
      await page.waitForFunction(() => window.__pw.mode === 'walk', null, { timeout });
      const before = await evaluate(page, () => ({ x: window.__pw.heroS.x, z: window.__pw.heroS.z }));
      await page.keyboard.down('w');
      await page.waitForFunction(({ x, z }) => Math.hypot(window.__pw.heroS.x - x, window.__pw.heroS.z - z) > 0.01, before, { timeout: Math.min(timeout, 20000) }).finally(() => page.keyboard.up('w'));
      result.screenshots.push(await screenshot(page, `${backend}-walking`));
      result.checks.push('walking controls and presentation');

      // Optional exposed wrapper uses the same encoder as the public Share action.
      const code = await evaluate(page, async () => typeof window.__pw.shareCode === 'function' ? await window.__pw.shareCode() : null);
      if (code) {
        console.log(`Checking ${backend}: shared-world reconstruction`);
        assert.match(code, /^[A-Za-z0-9_-]+$/);
        const sharedURL = new URL(url);
        sharedURL.hash = `w=${code}`;
        // A hash-only navigation would keep the current JS world alive, which
        // would not exercise decoding or reconstruction of the shared payload.
        await page.goto('about:blank');
        await page.goto(sharedURL.href, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForFunction(() => window.__pw?.W && typeof window.__pw.finishGrowth === 'function', null, { timeout });
        await evaluate(page, () => window.__pw.finishGrowth());
        await settle(page);
        assert.equal(snapshotHash(await evaluate(page, () => window.__pw.snapshot())), snapshotHash(regenerated), 'Share-link round trip moved world landmarks');
        result.checks.push('share-link round trip');
      }

      if (arg('mobile', 'yes') !== 'no') {
        console.log(`Checking ${backend}: portrait resize`);
        await page.setViewportSize({ width: 390, height: 844 });
        await generate(page, 'valley');
        const mobile = await state(page);
        assert.equal(mobile.canvas.width, 390, 'Portrait canvas did not resize at pinned pixel ratio');
        result.screenshots.push(await screenshot(page, `${backend}-portrait`));
        result.checks.push('portrait resize');
      }

      console.log(`Checking ${backend}: cancel generation while returning to paper`);
      await evaluate(page, () => {
        window.__pw.setQuality('medium');
        window.__pw.goPaper();
      });
      await page.waitForFunction(() => window.__pw.mode === 'draw' && !window.__pw.W);
      const retired = await state(page);
      assert(!retired.splats.pending, 'World generation remained pending after returning to paper');
      assert.equal(retired.splats.count, 0, 'Retired world still reports resident splats');
      assert.equal(retired.resources?.total, 0, 'Generated world resources remain owned after teardown');
      result.checks.push('world teardown and return to paper');

      const criticalWarnings = diagnostics.warnings.filter(w => /not supported|unsupported|validation|shader.*error|node.*error|Return statement used/i.test(w));
      assert.deepEqual(diagnostics.assets, [], 'Same-origin asset requests failed');
      assert.deepEqual(diagnostics.errors, [], 'Browser reported rendering or application errors');
      assert.deepEqual(criticalWarnings, [], 'Browser reported unsupported APIs or validation warnings');
      result.passed = true;
    } catch (error) {
      result.passed = false;
      result.failure = String(error.stack || error).slice(0, 16000);
      try { result.screenshots ??= []; result.screenshots.push(await screenshot(page, `${backend}-failure`)); } catch {}
    } finally {
      await context.close();
      await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.backendResults.length === backends.length && report.backendResults.every(r => r.passed);
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}

for (const result of report.backendResults) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.requestedBackend}: ${result.themes.length} themes, ${result.checks.length} interaction checks`);
  if (result.failure) console.error(result.failure);
}
console.log(`Report: ${resolve(output, 'report.json')}`);
if (!report.passed) process.exitCode = 1;
