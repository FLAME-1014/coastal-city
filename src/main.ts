import { districtAt, generateCity, type Building } from './city/layout';
import { inPolygon } from './city/geometry';
import { Simulation } from './city/simulation';
import { SceneManager, type SurfaceStatus } from './render/scene';
import type { Quality } from './render/performance';
import { Dashboard, type CameraMode, type Scope } from './ui/dashboard';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
const city = generateCity();
const buildings = new Map(city.buildings.map(item => [item.id, item]));
const sim = new Simulation();
let engine: SceneManager | undefined;
let quality: Quality | undefined;
let scope: Scope = 'all';
let selected: Building | undefined;
let view: CameraMode = 'orbit';
let surface: SurfaceStatus = 'loading';
let mounts = 0, released = 0, readyAt = 0;
const pageLife = new AbortController();

function setSelection(building: Building | undefined): void {
  selected = building;
  if (building) scope = building.district;
  ui.setSelection(building, scope);
  engine?.select(building);
}
function setView(mode: CameraMode): void { view = mode; ui.setView(mode); }
function sync(): void { ui.renderSimulation(sim); engine?.invalidate(); }

const ui = new Dashboard(root, city, 'balanced', {
  play() { if (surface === 'ready') { sim.setPlaying(!sim.playing); sync(); } },
  seek(minute) { sim.seek(minute); sync(); },
  speed(rate) { sim.setRate(rate); sync(); },
  weather(mode) { sim.setWeather(mode); sync(); },
  quality(value) { quality = value; engine?.setQuality(value); },
  view(mode) { setView(mode); engine?.setView(mode); },
  district(value) {
    scope = value;
    setSelection(undefined);
    setView(value === 'all' ? 'orbit' : 'free');
    if (value === 'all') engine?.setView('orbit');
    else engine?.focusDistrict(value);
  },
  point(point) {
    scope = inPolygon(point, city.coast) ? districtAt(point.x, point.z) : 'all';
    setSelection(undefined);
    setView('free');
    engine?.focusPoint(point);
  },
  building(id) {
    const building = buildings.get(id);
    if (!building) return;
    setSelection(building);
    setView('free');
    engine?.focusBuilding(building);
  },
  selectedFlight() { if (selected) { setView('free'); engine?.focusBuilding(selected); } },
  clear() { setSelection(undefined); },
  retry() { mount(); },
});

function setSurface(value: SurfaceStatus): void {
  surface = value;
  if (value === 'ready') readyAt = performance.now();
  if (value === 'unavailable') { sim.setPlaying(false); ui.renderSimulation(sim); }
  ui.surface(value);
}

function release(): void {
  if (!engine) return;
  engine.dispose();
  engine = undefined;
  released++;
}

function mount(): void {
  release();
  setSurface('loading');
  try {
    engine = new SceneManager(ui.host, city, sim, quality, {
      onStatus: setSurface, onSelect: setSelection, onHover: hover => ui.updateHover(hover), onHandsOn: () => setView('free'),
      onCamera: (position, aim) => ui.updateCamera(position, aim),
      onTelemetry: telemetry => { ui.renderSimulation(sim); ui.updateTelemetry(telemetry); },
    });
    mounts++;
    quality = engine.quality;
    ui.setQuality(quality);
    engine.select(selected);
    if (view !== 'free' && view !== 'orbit') engine.setView(view);
    else if (selected) engine.focusBuilding(selected);
    else if (scope !== 'all') engine.focusDistrict(scope);
    else setView('orbit');
  } catch (error) {
    console.warn('Tideline WebGL initialization did not complete:', error);
    setSurface('unavailable');
  }
}

ui.renderSimulation(sim);
mount();

function shutdown(): void { pageLife.abort(); release(); ui.dispose(); }
window.addEventListener('pagehide', event => {
  if (event.persisted) engine?.suspend();
  else shutdown();
}, { signal: pageLife.signal });
window.addEventListener('pageshow', event => { if (event.persisted) engine?.restore(); }, { signal: pageLife.signal });
if (import.meta.hot) import.meta.hot.dispose(shutdown);

if (new URLSearchParams(location.search).get('qa') === '1') {
  Object.defineProperty(window, '__tidelineQA', { configurable: true, value: Object.freeze({
    snapshot: () => ({ ...engine?.debugSnapshot(), surface, mounts, released, readyAt, scope, viewMode: view, paused: !sim.playing,
      selected: selected?.id, canvases: ui.host.querySelectorAll('canvas').length, buildings: city.buildings.length }),
    targets: () => engine?.debugTargets() ?? [],
  }) });
}
