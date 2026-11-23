import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.TIDELINE_REPORT_DIR ?? join(root, 'test-results'));
const report = { timestamp: new Date().toISOString(), node: process.version, os: process.platform, steps: [], errors: [], browserMessages: [], performance: [] };
const software = process.env.TIDELINE_GPU === 'software';
const soakSeconds = Number(process.env.TIDELINE_SOAK_SECONDS ?? 0);
const args = software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-unsafe-swiftshader'];
const read = page => page.evaluate(() => window.__tidelineQA.snapshot());
const idleOptions = { timeout: 20_000 };
const state = (page, expected) => page.waitForFunction(want => Object.entries(want).every(([key, value]) => window.__tidelineQA?.snapshot()[key] === value), expected, idleOptions);
const nav = page => page.getByRole('navigation', { name: '城市片区' });
const press = (page, name) => page.getByRole('button', { name, exact: true }).click();
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const between = (n, lo, hi) => n >= lo && n <= hi;

async function step(name, check) {
  const start = performance.now();
  try {
    const data = await check();
    const elapsedMs = Math.round(performance.now() - start);
    report.steps.push({ name, elapsedMs, passed: true, ...(data === undefined ? {} : { data }) });
    console.log(`PASS  ${name} (${elapsedMs} ms)`);
  } catch (error) {
    report.steps.push({ name, elapsedMs: Math.round(performance.now() - start), passed: false, error: String(error.stack ?? error) });
    throw error;
  }
}

function monitor(page, label, fallback = false) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push({ label, kind: 'pageerror', text: error.message }));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    const item = { label, kind: message.type(), text: message.text() };
    report.browserMessages.push(item);
    const expected = fallback && /WebGL|context/i.test(item.text);
    if (!expected && (message.type() === 'error' || /shader|GL_INVALID/i.test(item.text))) pageErrors.push(item);
  });
  page.on('response', response => { if (response.status() >= 400) pageErrors.push({ label, kind: 'http', text: `${response.status()} ${response.url()}` }); });
  page.on('requestfailed', request => pageErrors.push({ label, kind: 'requestfailed', text: `${request.url()} ${request.failure()?.errorText}` }));
  return pageErrors;
}

async function chromiumConfig() {
  if (process.env.TIDELINE_BROWSER_PATH) return { executablePath: process.env.TIDELINE_BROWSER_PATH };
  try { await access(chromium.executablePath()); return {}; }
  catch {
    if (process.platform === 'win32') {
      const chrome = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
      try { await access(chrome); return { executablePath: chrome }; } catch { /* use the Playwright install error */ }
    }
    return {};
  }
}

async function capture(page, name) {
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled', timeout: 25_000 });
}

async function collect(page, name, duration = 1900) {
  const sample = await page.evaluate(ms => new Promise(resolve => {
    const start = performance.now();
    const snapshots = [];
    let last = -1;
    const update = now => {
      const item = window.__tidelineQA.snapshot();
      if (item.frames !== last) { snapshots.push(item); last = item.frames; }
      if (now - start < ms) requestAnimationFrame(update);
      else resolve({ last: snapshots.at(-1), peakCalls: Math.max(...snapshots.map(s => s.drawCalls)),
        peakTriangles: Math.max(...snapshots.map(s => s.triangles)), measuredFrames: snapshots.length, wallMs: Math.round(now - start) });
    };
    requestAnimationFrame(update);
  }), duration);
  const { last: s, ...window } = sample;
  const result = { name, ...window, fps: Number(s.fps.toFixed(1)), p95FrameMs: Number(s.p95FrameMs.toFixed(2)), cpuP95Ms: Number(s.cpuP95Ms.toFixed(2)), gpuMs: s.gpuMs,
    drawCalls: s.drawCalls, triangles: s.triangles, points: s.points, meshes: s.meshes, instances: s.instances, geometries: s.geometries, textures: s.textures,
    shadowSize: s.shadowSize, pixels: s.pixels, actors: s.actors };
  report.performance.push(result);
  assert(result.measuredFrames >= 5, 'Scene must keep presenting frames');
  assert(between(result.peakCalls, 1, 179), `Draw call budget: ${result.peakCalls}`);
  assert(between(result.peakTriangles, 1, 249_999), `Triangle budget: ${result.peakTriangles}`);
  return result;
}

await mkdir(output, { recursive: true });
let server, browser, noGpu, page;
try {
  await access(join(root, 'dist', 'index.html'));
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'silent' });
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`, url = `${origin}/?qa=1`;
  const config = await chromiumConfig();
  browser = await chromium.launch({ ...config, headless: true, args });
  report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  const desktopErrors = monitor(page, 'desktop');
  const hosts = new Set();
  page.on('request', request => hosts.add(new URL(request.url()).origin));

  await step('Production boot, WebGL and city assets', async () => {
    await page.goto(url, { waitUntil: 'load' });
    await state(page, { surface: 'ready', canvases: 1 });
    const s = await read(page);
    assert(s.buildings > 100 && s.roads > 60 && s.windows > 8000);
    assert(s.actors.vehicles > 0 && s.actors.pedestrians > 0);
    report.gpu = await page.locator('canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    assert.deepEqual([...hosts], [origin]);
    if (software) { assert.equal(s.quality, 'economy'); assert.match(report.gpu, /swiftshader|software/i); }
    return { city: { buildings: s.buildings, windows: s.windows, roads: s.roads }, readyMs: Math.round(s.readyAt), gpu: report.gpu, defaultQuality: s.quality };
  });

  await step('Pause freezes motion and avoids unnecessary rendering', async () => {
    await press(page, '暂停模拟');
    await state(page, { paused: true });
    await state(page, { idle: true, frameRequested: false });
    const a = await read(page);
    await page.waitForTimeout(580);
    const b = await read(page);
    assert.equal(a.minute, b.minute);
    assert.deepEqual(a.vehicle, b.vehicle);
    assert.deepEqual(a.pedestrian, b.pedestrian);
    assert.equal(a.frames, b.frames);
    assert.equal(a.rafTicks, b.rafTicks);
  });

  await step('Visibility handler suspends and wakes the same scene', async () => {
    await page.getByRole('combobox', { name: '时间倍率' }).selectOption('24');
    await press(page, '继续模拟');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await state(page, { frameRequested: false });
    const hidden = await read(page);
    await page.waitForTimeout(650);
    const stillHidden = await read(page);
    assert.equal(stillHidden.minute, hidden.minute);
    assert.equal(stillHidden.frames, hidden.frames);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(last => window.__tidelineQA.snapshot().frames > last, hidden.frames);
    assert((await read(page)).minute - hidden.minute < 15);
    await press(page, '暂停模拟');
    await page.getByRole('combobox', { name: '时间倍率' }).selectOption('1');
  });

  await step('Canvas raycast, hover and drag suppression', async () => {
    const hit = await page.evaluate(() => window.__tidelineQA.targets()[0]);
    assert(hit, 'Visible clickable building');
    await page.mouse.move(hit.x, hit.y);
    await page.locator('#hover-label').waitFor({ state: 'visible' });
    await page.mouse.click(hit.x, hit.y);
    await state(page, { selected: hit.id });
    assert.match(await page.locator('.scope-kicker').textContent(), new RegExp(hit.id));
    const a = await read(page);
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x + 58, hit.y + 29, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(previous => Math.abs(window.__tidelineQA.snapshot().view[0] - previous) > 5, a.view[0]);
    assert.equal((await read(page)).selected, hit.id);
    await page.keyboard.press('Escape');
    await page.locator('#selected-title').waitFor({ state: 'detached' });
    return { picked: hit.id };
  });

  await step('Landmark search, keyboard lookup and building flight', async () => {
    const search = page.getByRole('searchbox', { name: '搜索建筑' });
    await search.fill('没有对应的楼');
    await page.getByText('没有匹配的建筑').waitFor();
    await search.fill('ｑｌ－００１');
    await search.press('Enter');
    await state(page, { selected: 'QL-001', scope: 'bay', moving: false });
    assert.equal(await page.locator('#selected-title').textContent(), '潮汐之门');
    assert.match(await page.locator('#city-info').textContent(), /140/);
    assert.equal(await page.locator('#map-building').getAttribute('visibility'), 'visible');
    await capture(page, 'landmark');
    await press(page, '清除选择');
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
  });

  await step('Camera presets, district fly-to and minimap projection', async () => {
    await press(page, '俯瞰');
    await state(page, { viewMode: 'plan', moving: false });
    assert((await read(page)).view[1] > 600);
    await press(page, '街道');
    await state(page, { viewMode: 'street', moving: false });
    assert((await read(page)).view[1] < 30);
    await capture(page, 'street');
    await press(page, '海岸');
    await state(page, { viewMode: 'coast', moving: false });
    assert(between((await read(page)).view[1], 70, 260));
    await capture(page, 'coast');
    await nav(page).getByRole('button', { name: '东岬港' }).click();
    await state(page, { scope: 'harbor', moving: false });
    assert(Math.abs((await read(page)).target[0] - 264) < 1);
    await page.locator('[data-map-district="green"]').click();
    await state(page, { scope: 'green', moving: false });
    const [x, , z] = (await read(page)).target;
    assert(Math.abs(x + 147) < 1 && Math.abs(z - 149) < 1);
    const map = page.locator('#city-map');
    const point = await map.evaluate(svg => {
      const p = new DOMPoint(-300, -200).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(point.x, point.y);
    await state(page, { scope: 'homes', moving: false });
    const aim = (await read(page)).target;
    // A 150px-wide map shows 950m; integer mouse coordinates are only accurate to one map pixel.
    assert(Math.abs(aim[0] + 300) < 7 && Math.abs(aim[2] + 200) < 7, `Map target: ${aim}`);
    assert.match(await page.locator('#coordinates').textContent(), new RegExp(`X ${Math.round(aim[0])} / Z ${Math.round(aim[2])}`));
  });

  await step('Keyboard movement and operation guide', async () => {
    await page.locator('canvas').focus();
    const before = (await read(page)).target;
    await page.keyboard.down('w');
    try { await page.waitForFunction(at => Math.hypot(...window.__tidelineQA.snapshot().target.map((x, i) => x - at[i])) > 4, before); }
    finally { await page.keyboard.up('w'); }
    assert(distance(before, (await read(page)).target) > 4);
    await page.keyboard.press('Space');
    await state(page, { paused: false });
    await page.keyboard.press('Space');
    await state(page, { paused: true });
    await press(page, '操作指南');
    await page.getByRole('dialog', { name: '操作指南' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await press(page, '回到全域');
    await state(page, { scope: 'all', moving: false });
  });

  await step('Weather particles, automatic schedule and day/night lighting', async () => {
    await press(page, '正午');
    await state(page, { minute: 720, weather: 'rain' });
    await page.waitForFunction(() => window.__tidelineQA.snapshot().sceneRain > 0.95);
    assert((await read(page)).points > 0);
    await press(page, '晴朗');
    await state(page, { sceneRain: 0, sceneSnow: 0 });
    const daylight = (await read(page)).sunIntensity;
    assert(daylight > 2);
    await press(page, '深夜');
    await state(page, { minute: 1290, sunIntensity: 0, points: 0 });
    assert.match(await page.locator('#solar').textContent(), /0\.00/);
    await capture(page, 'night');
    await press(page, '降雪');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().sceneSnow > 0.95 && window.__tidelineQA.snapshot().points > 0);
    await capture(page, 'snow');
    await press(page, '降雨');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().sceneRain > 0.95);
    assert.match(await page.locator('#condition-text').textContent(), /降雨/);
    const range = page.getByRole('slider', { name: '模拟时间' });
    await range.focus(); await page.keyboard.press('Home');
    await state(page, { minute: 0 });
    assert.equal(await page.locator('#clock').textContent(), '00:00');
    return { daylight, particles: (await read(page)).points };
  });

  await step('Event schedules change real district actors, and speed advances the clock', async () => {
    await press(page, '晴朗');
    await press(page, '清晨');
    await state(page, { activeEvent: 'commute', renderedMinute: 552 });
    await page.locator('[data-event-district="bay"]').click();
    await state(page, { scope: 'bay', moving: false });
    const commute = (await read(page)).districtActors.bay.vehicles;
    await press(page, '正午');
    await state(page, { activeEvent: 'dock', renderedMinute: 720 });
    const dock = await read(page);
    assert(commute > dock.districtActors.bay.vehicles);
    await press(page, '黄昏');
    await state(page, { activeEvent: 'market', renderedMinute: 1070 });
    const market = await read(page);
    assert(market.districtActors.harbor.vehicles > dock.districtActors.harbor.vehicles);
    assert(market.districtActors.green.pedestrians > dock.districtActors.green.pedestrians);
    await page.getByRole('combobox', { name: '时间倍率' }).selectOption('24');
    await press(page, '继续模拟');
    await page.waitForFunction(at => window.__tidelineQA.snapshot().minute > at + 4, market.minute);
    const after = await read(page);
    assert(distance(Object.values(market.vehicle).slice(0, 2), Object.values(after.vehicle).slice(0, 2)) > 1);
    assert(distance(Object.values(market.pedestrian).slice(0, 2), Object.values(after.pedestrian).slice(0, 2)) > 0.1);
    await press(page, '暂停模拟');
    await page.getByRole('combobox', { name: '时间倍率' }).selectOption('1');
    await press(page, '回到全域');
    await state(page, { moving: false });
    return { commute: { vehicles: commute }, dock: dock.districtActors.harbor, market: market.districtActors.green };
  });

  let baseline;
  await step('Render budgets and measurable geometry/pixel savings', async () => {
    await press(page, '清晨');
    await press(page, '继续模拟');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().samples >= 12);
    const quality = page.getByRole('combobox', { name: '渲染画质' });
    await quality.selectOption('balanced');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().samples >= 12);
    baseline = await collect(page, 'balanced-clear', software ? 3400 : 1900);
    await press(page, '降雨');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().sceneRain > 0.96);
    await capture(page, 'rain');
    const rainy = await collect(page, 'balanced-rain', software ? 3400 : 1900);
    assert(rainy.points > 0);
    await quality.selectOption('economy');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().samples >= 12);
    const light = await collect(page, 'economy-rain');
    assert(light.points < rainy.points && light.pixels < rainy.pixels && light.triangles < rainy.triangles);
    assert.equal(light.shadowSize, 0);
    await quality.selectOption('detail');
    await page.waitForFunction(() => window.__tidelineQA.snapshot().samples >= 12);
    const detail = await collect(page, 'detail-rain', software ? 4400 : 1900);
    assert(detail.shadowSize > rainy.shadowSize && detail.points > rainy.points);
    assert(detail.pixels > rainy.pixels);
    await quality.selectOption('balanced');
    await press(page, '晴朗');
    await press(page, '清晨');
    await press(page, '暂停模拟');
    await state(page, { sceneRain: 0, sceneSnow: 0, points: 0 });
    await capture(page, 'desktop');
    return { calls: baseline.peakCalls, triangles: baseline.peakTriangles, economyPixels: light.pixels, balancedPixels: rainy.pixels };
  });

  await step('Repeated view and quality changes do not accumulate resources', async () => {
    const start = await read(page);
    const quality = page.getByRole('combobox', { name: '渲染画质' });
    for (let i = 0; i < 3; i++) {
      await quality.selectOption('economy');
      await press(page, '降雪');
      await page.waitForFunction(() => window.__tidelineQA.snapshot().points > 0);
      await nav(page).getByRole('button', { name: ['东岬港', '湿地海岸', '白沙里'][i] }).click();
      await quality.selectOption('detail');
      await press(page, '正午');
      await press(page, '晴朗');
      await quality.selectOption('balanced');
      await press(page, '回到全域');
      await state(page, { moving: false, quality: 'balanced', points: 0, sceneSnow: 0 });
    }
    const end = await read(page);
    assert.equal(end.canvases, 1);
    assert.equal(end.mounts, 1);
    assert.equal(end.geometries, start.geometries);
    assert.equal(end.textures, start.textures);
    return { geometries: [start.geometries, end.geometries], textures: [start.textures, end.textures], canvases: end.canvases };
  });

  const forceLost = () => page.evaluate(() => {
    const ext = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context not supported');
    window.__testLostContext = ext;
    ext.loseContext();
  });

  await step('Context loss freezes rendering and native restore resumes it', async () => {
    const before = await read(page);
    await forceLost();
    await state(page, { surface: 'lost' });
    await page.getByText('图形连接已中断').waitFor();
    await page.evaluate(() => window.__testLostContext.restoreContext());
    await state(page, { surface: 'ready', canvases: 1, mounts: 1 });
    const restored = await read(page);
    assert(restored.frames > before.frames);
    assert(restored.geometries > 0 && restored.geometries <= before.geometries);
    assert(restored.textures > 0 && restored.textures <= before.textures);
    assert(between(restored.drawCalls, 1, 179) && between(restored.triangles, 25_000, 249_999));
    assert.equal(restored.minute, before.minute);
    const hit = await page.evaluate(() => window.__tidelineQA.targets()[0]);
    assert(hit, 'Restored context exposes a pickable structure');
    await page.mouse.click(hit.x, hit.y);
    await state(page, { selected: hit.id });
    await press(page, '清除选择');
    return { priorGeometries: before.geometries, restoredGeometries: restored.geometries, restoredDrawCalls: restored.drawCalls, picked: hit.id };
  });

  await step('Manual rebuild disposes the old context and keeps exactly one live scene', async () => {
    await forceLost();
    await state(page, { surface: 'lost' });
    await press(page, '重建三维视图');
    await state(page, { surface: 'ready', canvases: 1, mounts: 2, released: 1 });
    const start = await read(page);
    await press(page, '继续模拟');
    await page.waitForFunction(frames => window.__tidelineQA.snapshot().frames > frames + 5, start.frames);
    const rebuilt = await read(page);
    assert.equal(rebuilt.geometries, start.geometries);
    assert.deepEqual(desktopErrors, []);
    return { canvases: rebuilt.canvases, mounts: rebuilt.mounts, released: rebuilt.released };
  });

  if (soakSeconds > 0) await step('Accelerated multi-day soak keeps scene resources bounded', async () => {
    assert(Number.isFinite(soakSeconds) && between(soakSeconds, 70, 600), 'TIDELINE_SOAK_SECONDS must be 70–600');
    await press(page, '自动');
    await page.getByRole('combobox', { name: '时间倍率' }).selectOption('60');
    const result = await page.evaluate(ms => new Promise(resolve => {
      const first = window.__tidelineQA.snapshot(), start = performance.now();
      const weather = new Set(), events = new Set(), days = new Set();
      let tick = 0, peakCalls = 0, peakTriangles = 0, stableMin = Infinity, stableMax = 0, stableTextures = 0;
      const timer = setInterval(() => {
        const s = window.__tidelineQA.snapshot(), elapsed = performance.now() - start;
        weather.add(s.weather); days.add(s.day);
        if (s.activeEvent) events.add(s.activeEvent);
        peakCalls = Math.max(peakCalls, s.drawCalls); peakTriangles = Math.max(peakTriangles, s.triangles);
        if (elapsed > 27_000) {
          stableMin = Math.min(stableMin, s.geometries); stableMax = Math.max(stableMax, s.geometries);
          stableTextures = Math.max(stableTextures, s.textures);
        }
        tick++;
        if (elapsed >= ms) {
          clearInterval(timer);
          resolve({ elapsedMs: Math.round(elapsed), frames: s.frames - first.frames, days: [...days], weather: [...weather].sort(), events: [...events].sort(),
            canvases: s.canvases, mounts: s.mounts, peakCalls, peakTriangles, geometries: [stableMin, stableMax], texturePeak: stableTextures, samples: tick });
        }
      }, 250);
    }), soakSeconds * 1000);
    assert(result.days.length >= 3, `Expected multiple simulated days, observed ${result.days}`);
    assert.deepEqual(result.weather, ['clear', 'rain', 'snow']);
    assert.deepEqual(result.events, ['commute', 'dock', 'market']);
    assert.equal(result.canvases, 1); assert.equal(result.mounts, 2);
    assert(result.peakCalls < 180 && result.peakTriangles < 250_000);
    assert(result.geometries[0] > 0 && result.geometries[1] === result.geometries[0] && result.texturePeak <= 8);
    assert.deepEqual(desktopErrors, []);
    return result;
  });

  await page.close();
  await step('Mobile touch, controls and no horizontal overflow', async () => {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = monitor(mobile, 'mobile');
    await mobile.goto(url);
    await state(mobile, { surface: 'ready', canvases: 1 });
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.getByRole('button', { name: '暂停模拟' }).tap();
    await state(mobile, { paused: true });
    await capture(mobile, 'mobile');
    const hit = await mobile.evaluate(() => window.__tidelineQA.targets()[0]);
    assert(hit, 'Mobile view must expose a tappable building');
    await mobile.touchscreen.tap(hit.x, hit.y);
    await state(mobile, { selected: hit.id });
    await mobile.getByRole('button', { name: '降雪', exact: true }).tap();
    await state(mobile, { weather: 'snow' });
    await mobile.getByRole('combobox', { name: '渲染画质' }).selectOption('economy');
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.setViewportSize({ width: 320, height: 740 });
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await mobile.close();
    return { viewport: [390, 844], touchPicked: hit.id };
  });

  await step('WebGL-disabled browser retains navigation and building data', async () => {
    noGpu = await chromium.launch({ ...config, headless: true, args: ['--disable-webgl', '--disable-webgl2'] });
    const fallback = await noGpu.newPage({ viewport: { width: 1220, height: 810 } });
    const errors = monitor(fallback, 'fallback', true);
    await fallback.goto(url);
    await state(fallback, { surface: 'unavailable', canvases: 0, paused: true });
    await fallback.getByText('无法启动三维视图').waitFor();
    assert(await fallback.getByRole('button', { name: '继续模拟' }).isDisabled());
    await fallback.getByRole('searchbox', { name: '搜索建筑' }).fill('QL-003');
    await fallback.getByRole('searchbox', { name: '搜索建筑' }).press('Enter');
    await state(fallback, { selected: 'QL-003' });
    assert.equal(await fallback.locator('#selected-title').textContent(), '环湾渡运站');
    await capture(fallback, 'fallback');
    assert.deepEqual(errors, []);
    await noGpu.close(); noGpu = undefined;
  });

  report.bundle = await Promise.all((await readdir(join(root, 'dist/assets'))).map(async name => {
    const src = await readFile(join(root, 'dist/assets', name));
    return { name, bytes: src.length, gzip: gzipSync(src).length };
  }));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errors.push(String(error.stack ?? error));
  console.error(error);
  if (page && !page.isClosed()) await capture(page, 'failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await noGpu?.close();
  await browser?.close();
  await server?.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.passed ? 'PASS' : 'FAIL'}  ${join(output, 'report.json')}`);
}
