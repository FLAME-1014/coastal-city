import { DISTRICTS, STYLE_NAMES, searchBuildings, type Building, type CityLayout, type DistrictId } from '../city/layout';
import { clockText, conditions, SPEEDS, WEATHER_NAMES, type Simulation, type WeatherMode } from '../city/simulation';
import type { Point } from '../city/geometry';
import { VIEWS, type View } from '../render/camera';
import { QUALITY, type Quality } from '../render/performance';
import type { Hover } from '../render/interaction';
import type { SurfaceStatus, Telemetry } from '../render/scene';
import { icon, mark } from './icons';
import { MiniMap, minimapMarkup } from './minimap';

export type Scope = DistrictId | 'all';
export type CameraMode = View | 'free';
interface Actions {
  play(): void; seek(minute: number): void; speed(rate: number): void; weather(mode: WeatherMode): void; quality(quality: Quality): void;
  view(view: View): void; district(scope: Scope): void; point(point: Point): void;
  building(id: string): void; selectedFlight(): void; clear(): void; retry(): void;
}

const weatherModes = [{ id: 'auto', name: '自动' }, { id: 'clear', name: '晴朗' }, { id: 'rain', name: '降雨' }, { id: 'snow', name: '降雪' }] as const;
const fmt = (n: number): string => n.toLocaleString('zh-CN');

function template(city: CityLayout, quality: Quality): string {
  return `
  <header class="masthead">
    <div class="brand"><span class="brand-mark">${mark}</span><span><strong>栖潮城市实验室</strong><small>TIDELINE SIMULATION LAB</small></span></div>
    <div class="mast-context"><span></span>城市运行观测台</div>
    <div class="mast-controls">
      <div id="sim-state" class="live-state"><span></span><b>模拟运行中</b></div>
      <div class="clock"><span id="day">DAY 01</span><time id="clock">09:12</time></div>
      <button type="button" id="play" class="play" data-act="play" aria-label="暂停模拟" title="暂停模拟">${icon('pause')}</button>
    </div>
  </header>
  <main class="shell">
    <div class="page-intro">
      <div><div class="eyebrow"><span></span> TIDELINE / COASTAL SECTOR 01</div>
        <h1>未来海滨城市</h1><p>探索栖潮的四个片区，观察城市在不同时间与天气下的运行状态。</p></div>
      <div class="intro-actions"><span class="scenario-tag"><i></i>模拟数据</span><button type="button" class="text-button" data-act="help">${icon('help', 16)} 操作指南</button></div>
    </div>
    <div class="workspace">
      <section class="atlas" aria-labelledby="atlas-title">
        <div class="atlas-header">
          <div class="atlas-heading"><span class="atlas-icon">${icon('orbit', 17)}</span><div><h2 id="atlas-title">三维城区</h2><span>本地规划坐标系 · 米</span></div></div>
          <div class="atlas-actions"><span id="surface-state" class="surface-state"><i></i><span>加载中</span></span><button type="button" class="text-button reset" data-act="reset" title="回到全域" aria-label="回到全域">${icon('reset', 16)} <span>回到全域</span></button></div>
        </div>
        <div class="stage" id="stage">
          <div class="canvas-host" id="canvas-host"></div>
          <div class="scene-tag" aria-hidden="true"><span class="reticle">${icon('target', 18)}</span><span><b id="scene-district">全域观察</b><small id="coordinates">X −10 / Z −20</small></span></div>
          <div class="compass" aria-hidden="true"><span>N</span><svg id="compass-needle" viewBox="0 0 28 28" width="23" height="23"><path d="M14 3 20 22l-6-4-6 4Z" fill="#a8e2d7"/><path d="M14 3v15l-6 4Z" fill="#548d89"/></svg></div>
          <div class="view-block" aria-label="相机视图">
            <div class="view-controls" role="group" aria-label="相机预设">${VIEWS.map(v => `<button type="button" aria-pressed="${v.id === 'orbit'}" data-view="${v.id}">${icon(v.id, 16)} <span>${v.name}</span></button>`).join('')}</div>
            <p id="camera-hint">拖拽旋转 · 滚轮缩放 · 右键平移 · 点击建筑查看</p>
          </div>
          <section class="minimap" aria-label="位置概览"><div class="minimap-title"><span>${icon('map', 13)} 区域地图</span><b>N ↑</b></div>${minimapMarkup(city)}<div class="minimap-footer"><span>点击地图定位</span><span>米</span></div></section>
          <div id="surface-note" class="surface-note" role="status"><div class="surface-symbol">${icon('orbit', 25)}</div><strong id="surface-title">正在建立城区</strong><p id="surface-description">加载道路、建筑和实时环境…</p><button type="button" class="text-button" data-act="retry" hidden>重建三维视图</button></div>
          <div id="hover-label" class="hover-label" hidden></div>
        </div>
        <nav class="district-strip" aria-label="城市片区"><span class="district-label">片区</span><button type="button" data-district="all" aria-pressed="true">全域</button>${DISTRICTS.map(d => `<button type="button" data-district="${d.id}" aria-pressed="false" style="--district:${d.color}"><i></i>${d.name}</button>`).join('')}</nav>
      </section>
      <aside class="inspector" aria-label="城市资料与环境控制">
        <section class="panel registry" aria-labelledby="registry-title">
          <div class="panel-top"><div><span class="panel-index">01 / ATLAS</span><h2 id="registry-title">城市资料</h2></div><span class="panel-icon">${icon('map', 18)}</span></div>
          <form class="lookup" id="lookup" role="search"><label class="lookup-input">${icon('search', 17)}<input id="asset-search" type="search" placeholder="搜索建筑、编号或片区" aria-label="搜索建筑" aria-controls="asset-results" autocomplete="off"></label><button type="button" class="lookup-toggle" id="show-assets" aria-expanded="false" aria-controls="asset-results" title="浏览地标" aria-label="浏览地标">${icon('locate', 17)}</button></form>
          <div class="asset-results" id="asset-results" hidden><p id="result-caption" role="status"></p><ul id="result-list"></ul></div>
          <div id="city-info" class="city-info"></div>
        </section>
        <section class="panel environment" aria-labelledby="environment-title">
          <div class="panel-top"><div><span class="panel-index">02 / ENVIRONMENT</span><h2 id="environment-title">环境控制</h2></div><span class="panel-icon" id="condition-icon">${icon('clear', 18)}</span></div>
          <div class="time-head"><label for="time-range">模拟时间</label><output id="time-value" for="time-range">09:12</output><label class="speed-label"><span class="sr-only">时间倍率</span><select id="speed">${SPEEDS.map(n => `<option value="${n}">${n}×</option>`).join('')}</select></label></div>
          <input id="time-range" class="time-range" type="range" min="0" max="1439" step="1" value="552">
          <div class="time-scale" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          <div class="time-marks" role="group" aria-label="时间预设"><button type="button" data-time="552">清晨</button><button type="button" data-time="720">正午</button><button type="button" data-time="1070">黄昏</button><button type="button" data-time="1290">深夜</button></div>
          <div class="weather-head"><span>天气</span><b id="condition-text">晴朗 · 23°C</b></div>
          <div class="weather-controls" role="group" aria-label="天气模式">${weatherModes.map(w => `<button type="button" data-weather="${w.id}" aria-pressed="${w.id === 'auto'}">${icon(w.id, 15)} <span>${w.name}</span></button>`).join('')}</div>
          <div class="conditions"><span id="wind">风速 —</span><span id="visibility">能见度 —</span><span id="solar">光伏 —</span></div>
        </section>
        <section class="panel event-panel" aria-labelledby="event-title">
          <div class="panel-top"><div><span class="panel-index">03 / CITY EVENTS</span><h2 id="event-title">城市事件</h2></div><span class="panel-icon amber">${icon('event', 18)}</span></div>
          <div id="event-info"></div>
        </section>
      </aside>
    </div>
    <section class="system-bar" aria-label="运行统计">
      <div class="system-title"><span>${icon('chart', 18)}</span><div><strong>运行统计</strong><small>RENDER TELEMETRY</small></div></div>
      <div class="stat"><span>场景帧率</span><b id="fps">—</b></div><div class="stat"><span>绘制调用</span><b id="calls">—</b></div><div class="stat"><span>三角面</span><b id="triangles">—</b></div>
      <div class="stat perf-optional"><span>CPU 帧处理 P95</span><b id="cpu">—</b></div><div class="stat perf-optional"><span>GPU 时间</span><b id="gpu">—</b></div>
      <div class="stat trip"><span>模拟交通 / 行人</span><b id="actors">—</b></div>
      <label class="quality"><span>渲染画质</span><select id="quality">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}"${k === quality ? ' selected' : ''}>${q.label}</option>`).join('')}</select></label>
    </section>
    <footer class="site-footer"><span>栖潮市 · 合成城市与模拟遥测</span><span>本地坐标 X 向东 / Z 向南</span></footer>
  </main>
  <dialog id="help" aria-labelledby="help-title"><div class="dialog-top"><div><span class="panel-index">FIELD GUIDE</span><h2 id="help-title">操作指南</h2></div><form method="dialog"><button type="submit" class="icon-button" aria-label="关闭指南">${icon('close')}</button></form></div>
    <dl><div><dt>浏览三维城市</dt><dd>左键拖拽旋转、滚轮缩放、右键拖拽平移。触屏用单指旋转，两指可缩放和平移。</dd></div><div><dt>自由移动</dt><dd>点一下场景使其获得焦点后，使用 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或方向键移动；<kbd>Q</kbd>/<kbd>E</kbd> 降低/升高，<kbd>Shift</kbd> 加速。</dd></div><div><dt>查看与定位</dt><dd>点击建筑查看资料，或在资料面板检索后定位。片区按钮和小地图都能移动相机，<kbd>Esc</kbd> 清除选择。</dd></div><div><dt>模拟情景</dt><dd><kbd>Space</kbd> 暂停/继续。可拨动时间和切换天气；暂停时车辆、行人和模拟时间冻结。</dd></div></dl>
    <form method="dialog"><button type="submit" class="primary-button">开始探索 ${icon('arrow', 15)}</button></form>
  </dialog>`;
}

export class Dashboard {
  readonly host: HTMLElement;
  private readonly life = new AbortController();
  private readonly map: MiniMap;
  private readonly search: HTMLInputElement;
  private readonly results: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly help: HTMLDialogElement;
  private readonly byId: Record<string, HTMLElement>;
  private readonly time: HTMLInputElement;
  private readonly weatherButtons: HTMLButtonElement[];
  private readonly timeButtons: HTMLButtonElement[];
  private readonly viewButtons: HTMLButtonElement[];
  private readonly districtButtons: HTMLButtonElement[];
  private readonly capacity: number;
  private peek: Building | undefined;
  private scope: Scope = 'all';
  private found: Building[] = [];
  private previousSim = '';
  private previousEvent = '';
  private previousConditions = '';
  private assetOpen = false;
  private latest: Telemetry | undefined;

  constructor(private readonly root: HTMLElement, private readonly city: CityLayout, quality: Quality, private readonly actions: Actions) {
    root.innerHTML = template(city, quality);
    this.byId = Object.fromEntries(Array.from(root.querySelectorAll<HTMLElement>('[id]:not(svg *)'), el => [el.id, el]));
    this.host = this.get('canvas-host');
    this.search = this.get('asset-search');
    this.results = this.get('asset-results');
    this.tooltip = this.get('hover-label');
    this.help = this.get('help');
    this.time = this.get('time-range');
    this.weatherButtons = Array.from(root.querySelectorAll('[data-weather]'));
    this.timeButtons = Array.from(root.querySelectorAll('[data-time]'));
    this.viewButtons = Array.from(root.querySelectorAll('[data-view]'));
    this.districtButtons = Array.from(root.querySelectorAll('[data-district]'));
    this.capacity = city.buildings.reduce((sum, b) => sum + b.solarKw, 0);
    this.map = new MiniMap(root, this.life.signal, actions.point, actions.district);
    this.bind();
    this.setSelection(undefined, 'all');
  }

  private get<E extends HTMLElement = HTMLElement>(id: string): E {
    const el = this.byId[id];
    if (!el) throw new Error(`Missing dashboard element: ${id}`);
    return el as E;
  }
  private text(id: string, value: string): void { const el = this.get(id); if (el.textContent !== value) el.textContent = value; }

  private bind(): void {
    const { signal } = this.life, { actions } = this;
    this.root.addEventListener('click', e => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      const d = button.dataset;
      if (d.act === 'play') actions.play();
      else if (d.act === 'help') this.help.showModal();
      else if (d.act === 'reset') actions.district('all');
      else if (d.act === 'retry') actions.retry();
      else if (d.act === 'clear') { actions.clear(); this.search.focus(); }
      else if (d.act === 'fly') actions.selectedFlight();
      else if (d.asset) { actions.building(d.asset); this.closeAssetsAfterChoice(); }
      else if (d.view) actions.view(d.view as View);
      else if (d.district) actions.district(d.district as Scope);
      else if (d.eventDistrict) actions.district(d.eventDistrict as Scope);
      else if (d.time) actions.seek(Number(d.time));
      else if (d.weather) actions.weather(d.weather as WeatherMode);
    }, { signal });
    this.get('show-assets').addEventListener('click', () => this.showAssets(!this.assetOpen), { signal });
    this.search.addEventListener('input', () => this.showAssets(true), { signal });
    this.search.addEventListener('focus', () => { if (this.search.value) this.showAssets(true); }, { signal });
    this.get('lookup').addEventListener('submit', e => {
      e.preventDefault();
      if (!this.assetOpen) this.showAssets(true);
      const match = this.found[0];
      if (match) { actions.building(match.id); this.closeAssetsAfterChoice(); }
    }, { signal });
    this.time.addEventListener('input', () => actions.seek(Number(this.time.value)), { signal });
    this.get<HTMLSelectElement>('speed').addEventListener('change', e => actions.speed(Number((e.target as HTMLSelectElement).value)), { signal });
    this.get<HTMLSelectElement>('quality').addEventListener('change', e => actions.quality((e.target as HTMLSelectElement).value as Quality), { signal });
    document.addEventListener('keydown', e => {
      if (this.help.open) return;
      const focused = e.target as Element;
      if (e.code === 'Escape') {
        if (this.assetOpen) this.showAssets(false);
        else if (this.peek) { const fromDetails = !!focused.closest?.('.build-actions'); actions.clear(); if (fromDetails) this.search.focus(); }
      }
      if (e.code === 'Space' && !e.repeat && !focused.closest?.('button, input, select, textarea, [contenteditable="true"], a, summary')) {
        e.preventDefault(); actions.play();
      }
    }, { signal });
    document.addEventListener('pointerdown', e => {
      if (this.assetOpen && !(e.target as Element).closest('.registry')) this.showAssets(false);
    }, { signal });
  }

  private closeAssetsAfterChoice(): void {
    this.search.value = '';
    this.showAssets(false);
    this.root.querySelector<HTMLElement>('#selected-title')?.focus();
  }

  private showAssets(show: boolean): void {
    this.assetOpen = show;
    this.results.hidden = !show;
    this.get('show-assets').setAttribute('aria-expanded', String(show));
    if (!show) return;
    const query = this.search.value.trim();
    const found = query ? searchBuildings(this.city.buildings, query) : this.city.buildings.filter(b => b.landmark);
    this.found = found.slice(0, 10);
    this.text('result-caption', query ? (found.length ? `${found.length} 个结果${found.length > 10 ? ' · 显示前 10 个' : ''}` : '没有匹配的建筑') : '推荐地标');
    this.get('result-list').innerHTML = this.found.map(b => `<li><button type="button" data-asset="${b.id}"><span><b>${b.name}</b><small>${b.id} · ${STYLE_NAMES[b.style]}</small></span>${icon('arrow', 14)}</button></li>`).join('');
  }

  setSelection(b: Building | undefined, scope: Scope): void {
    this.peek = b; this.scope = scope;
    const district = DISTRICTS.find(d => d.id === scope);
    this.map.select(b); this.map.district(district?.id);
    this.districtButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.district === scope)));
    this.text('scene-district', b?.name ?? district?.name ?? '全域观察');
    const pane = this.get('city-info');
    if (b) {
      pane.innerHTML = `<div class="scope-kicker"><i style="--district:${district?.color}"></i>${district?.name} / ${b.id}</div>
        <h3 id="selected-title" tabindex="-1">${b.name}</h3><p>${b.description}</p>
        <dl class="info-stats building"><div><dt>高度</dt><dd>${b.height}<small> m</small></dd></div><div><dt>楼层</dt><dd>${b.floors}<small> 层</small></dd></div><div><dt>屋顶光伏</dt><dd>${b.solarKw}<small> kW</small></dd></div></dl>
        <div class="build-actions"><button type="button" class="primary-button" data-act="fly">${icon('locate', 15)} 定位建筑</button><button type="button" class="text-button" data-act="clear">清除选择</button></div>`;
    } else {
      const buildings = district ? this.city.buildings.filter(item => item.district === scope).length : this.city.buildings.length;
      const blocks = district ? this.city.blocks.filter(item => item.district === scope).length : this.city.blocks.length;
      pane.innerHTML = `<div class="scope-kicker"><i style="--district:${district?.color ?? '#90d2c8'}"></i>${district ? `${district.code} / ${district.en}` : 'TIDELINE / CITY OVERVIEW'}</div>
        <h3>${district?.name ?? '栖潮市'}</h3><p>${district?.summary ?? '沿弧形海岸展开的规划城市，包含商务核心、港区、住区和生态缓冲带。'}</p>
        <dl class="info-stats"><div><dt>建筑</dt><dd>${buildings}</dd></div><div><dt>街区</dt><dd>${blocks}</dd></div><div><dt>车辆 · 行人</dt><dd data-local-actors>—</dd></div></dl>`;
      this.updateLocalActors();
    }
  }

  setView(mode: CameraMode): void { this.viewButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode))); }
  setQuality(quality: Quality): void { this.get<HTMLSelectElement>('quality').value = quality; }
  updateCamera(position: Point, aim: Point): void {
    const angle = this.map.update(position, aim);
    this.root.querySelector<SVGElement>('#compass-needle')!.style.transform = `rotate(${-angle}deg)`;
    this.text('coordinates', `X ${Math.round(aim.x)} / Z ${Math.round(aim.z)}`);
  }
  updateHover(hover: Hover | undefined): void {
    this.tooltip.hidden = !hover;
    if (!hover) return;
    this.tooltip.textContent = `${hover.building.name} · ${hover.building.height} m`;
    const rect = this.get('stage').getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(6, Math.min(rect.width - this.tooltip.offsetWidth - 7, hover.x - rect.left + 14))}px`;
    this.tooltip.style.top = `${Math.max(7, hover.y - rect.top - 39)}px`;
  }

  surface(status: SurfaceStatus): void {
    const note = this.get('surface-note'), badge = this.get('surface-state');
    note.hidden = status === 'ready';
    badge.dataset.state = status;
    badge.querySelector('span')!.textContent = ({ ready: '3D 已就绪', loading: '加载中', lost: '视图已暂停', unavailable: '3D 不可用' })[status];
    this.host.parentElement!.dataset.surface = status;
    this.get<HTMLButtonElement>('play').disabled = status !== 'ready';
    if (status !== 'ready') {
      this.text('surface-title', status === 'loading' ? '正在建立城区' : status === 'lost' ? '图形连接已中断' : '无法启动三维视图');
      this.text('surface-description', status === 'loading' ? '加载道路、建筑和实时环境…' : status === 'lost' ? '图形连接恢复后会继续，也可手动重建。' : '请检查浏览器是否支持 WebGL 2，或使用小地图和建筑资料。');
      note.querySelector<HTMLButtonElement>('button')!.hidden = status === 'loading';
    }
  }

  renderSimulation(sim: Simulation): void {
    const slot = Math.floor(sim.minute), clock = clockText(slot);
    const key = `${sim.day}/${slot}/${sim.playing}/${sim.rate}/${sim.mode}/${sim.weather}`;
    if (this.previousSim === key) return;
    this.previousSim = key;
    this.text('clock', clock); this.text('time-value', clock);
    this.text('day', `DAY ${String(sim.day).padStart(2, '0')}`);
    this.time.value = String(slot);
    this.time.style.setProperty('--progress', `${slot / 14.39}%`);
    this.time.setAttribute('aria-valuetext', clock);
    this.get<HTMLSelectElement>('speed').value = String(sim.rate);
    const play = this.get('play'), playLabel = sim.playing ? '暂停模拟' : '继续模拟';
    if (play.getAttribute('aria-label') !== playLabel) { play.setAttribute('aria-label', playLabel); play.title = playLabel; play.innerHTML = icon(sim.playing ? 'pause' : 'play'); }
    const status = this.get('sim-state');
    status.classList.toggle('is-paused', !sim.playing); status.querySelector('b')!.textContent = sim.playing ? '模拟运行中' : '模拟已暂停';
    this.weatherButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.weather === sim.mode)));
    this.timeButtons.forEach(b => b.classList.toggle('is-now', Math.abs(Number(b.dataset.time) - slot) < 9));
    const metrics = conditions(slot, sim.weather);
    const iconWrap = this.get('condition-icon');
    if (iconWrap.dataset.weather !== sim.weather) { iconWrap.dataset.weather = sim.weather; iconWrap.innerHTML = icon(sim.weather, 18); }
    const weatherKey = `${sim.weather}/${metrics.temperature}/${metrics.windKmh}/${metrics.visibilityKm}/${Math.round(this.capacity * metrics.solarFraction / 10)}`;
    if (weatherKey !== this.previousConditions) {
      this.previousConditions = weatherKey;
      this.text('condition-text', `${WEATHER_NAMES[sim.weather]} · ${metrics.temperature}°C`);
      this.text('wind', `风速 ${metrics.windKmh} km/h`);
      this.text('visibility', `能见度 ${metrics.visibilityKm} km`);
      this.text('solar', `光伏 ${(this.capacity * metrics.solarFraction / 1000).toFixed(2)} MW`);
    }
    const active = sim.activeEvent, next = sim.nextEvent;
    const eventKey = `${active?.id}/${next.id}`;
    if (eventKey !== this.previousEvent) {
      this.previousEvent = eventKey;
      const d = DISTRICTS.find(a => a.id === active?.district);
      this.get('event-info').innerHTML = `${active ? `<button type="button" data-event-district="${active.district}" class="event-active" title="定位${d?.name}"><span><small><i></i> 进行中 · ${d?.name}</small><strong>${active.title}</strong></span>${icon('arrow', 15)}</button><p>${active.text}</p>` : '<p class="no-event"><i></i>当前无计划事件</p>'}<div class="next-event"><small>下一事件</small><span>${clockText(next.start)} · ${next.title}</span></div>`;
    }
  }

  updateTelemetry(value: Telemetry): void {
    this.latest = value;
    const { metrics: m, actors } = value;
    this.text('fps', m.idle ? '静态' : m.samples ? `${m.fps.toFixed(0)} FPS` : '—');
    this.text('calls', fmt(m.drawCalls));
    this.text('triangles', fmt(m.triangles));
    this.text('cpu', m.cpuP95Ms > 0 ? `${m.cpuP95Ms.toFixed(1)} ms` : '—');
    this.text('gpu', m.gpuMs === null ? '—' : `${m.gpuMs.toFixed(1)} ms`);
    this.text('actors', `${actors.vehicles} / ${actors.pedestrians}`);
    this.updateLocalActors();
  }
  private updateLocalActors(): void {
    const cell = this.root.querySelector<HTMLElement>('[data-local-actors]');
    if (!cell || !this.latest) return;
    const numbers = this.scope === 'all' ? this.latest.actors : this.latest.districtActors[this.scope];
    const value = `${numbers.vehicles} · ${numbers.pedestrians}`;
    if (cell.textContent !== value) cell.textContent = value;
  }
  dispose(): void { this.life.abort(); }
}
