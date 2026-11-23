import * as T from 'three';
import { GROUND, SEED, type Building, type CityLayout, type DistrictId } from '../city/layout';
import type { Point } from '../city/geometry';
import type { Simulation } from '../city/simulation';
import { BuildingSystem } from './buildings';
import { CameraController, type View } from './camera';
import { Environment } from './environment';
import { Infrastructure } from './infrastructure';
import { InteractionSystem, type Hover } from './interaction';
import { defaultQuality, PerformanceMonitor, QUALITY, type Metrics, type Quality } from './performance';
import { disposeScene } from './resources';
import { TrafficSystem, type Count } from './traffic';
import { WeatherSystem } from './weather';

export type SurfaceStatus = 'loading' | 'ready' | 'lost' | 'unavailable';
export interface Telemetry { metrics: Metrics; actors: Count; districtActors: Record<DistrictId, Count> }
interface Callbacks {
  onStatus(status: SurfaceStatus): void;
  onSelect(building: Building | undefined): void;
  onHover(hover: Hover | undefined): void;
  onHandsOn(): void;
  onCamera(position: T.Vector3, target: T.Vector3): void;
  onTelemetry(value: Telemetry): void;
}

export class SceneManager {
  readonly canvas = document.createElement('canvas');
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera: CameraController;
  private readonly environment: Environment;
  private readonly weather: WeatherSystem;
  private readonly buildings: BuildingSystem;
  private readonly infrastructure: Infrastructure;
  private readonly traffic: TrafficSystem;
  private readonly interaction: InteractionSystem;
  private readonly perf: PerformanceMonitor;
  private readonly events = new AbortController();
  private readonly sizeObserver: ResizeObserver;
  private readonly projected = new T.Vector3();
  private raf = 0;
  private last = 0;
  private lastVisual = 0;
  private renderedMinute = 0;
  private rafTicks = 0;
  private inFrame = false;
  private reportAt = -Infinity;
  private lastShadowAt = -Infinity;
  private lastShadowMinute = -Infinity;
  private dirty = true;
  private forceState = true;
  private destroyed = false;
  private suspended = false;
  private status: SurfaceStatus = 'loading';
  private _quality: Quality;
  private selected: Building | undefined;

  constructor(private readonly host: HTMLElement, private readonly layout: CityLayout, private readonly sim: Simulation,
    quality: Quality | undefined, private readonly callbacks: Callbacks) {
    // Allocate the WebGL context before mounting pointer listeners or generating the city.
    const context = this.canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: devicePixelRatio < 2.1, alpha: false });
    if (!context) throw new Error('WebGL 2 context unavailable');
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, context });
    this._quality = quality ?? defaultQuality(this.renderer);
    let camera: CameraController | undefined, interaction: InteractionSystem | undefined, observer: ResizeObserver | undefined;
    try {
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.shadowMap.type = T.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.info.autoReset = false;
      this.canvas.tabIndex = 0;
      this.canvas.setAttribute('aria-label', '栖潮市三维场景');
      this.canvas.setAttribute('aria-describedby', 'camera-hint');
      this.environment = new Environment(SEED); this.scene.add(this.environment.group);
      this.weather = new WeatherSystem(SEED); this.scene.add(this.weather.points);
      this.buildings = new BuildingSystem(layout, SEED); this.scene.add(this.buildings.group);
      this.infrastructure = new Infrastructure(layout, SEED); this.scene.add(this.infrastructure.group);
      this.traffic = new TrafficSystem(layout, SEED); this.scene.add(this.traffic.group);
      this.camera = camera = new CameraController(this.canvas, callbacks.onHandsOn, this.wake);
      this.interaction = interaction = new InteractionSystem(this.canvas, this.camera.camera, this.buildings, callbacks.onSelect, callbacks.onHover, this.wake);
      this.perf = new PerformanceMonitor(this.renderer);
      this.scene.add(this.interaction.group);
      this.scene.fog = this.environment.fog;
      this.host.append(this.canvas);
      const { signal } = this.events;
      this.canvas.addEventListener('webglcontextlost', this.contextLost, { signal });
      this.canvas.addEventListener('webglcontextrestored', this.contextRestored, { signal });
      document.addEventListener('visibilitychange', this.visibility, { signal });
      window.addEventListener('resize', this.resize, { signal });
      this.sizeObserver = observer = new ResizeObserver(this.resize);
      observer.observe(host);
      this.setQuality(this._quality);
      this.camera.setView('orbit', true);
      this.wake();
    } catch (error) {
      this.stop(); this.events.abort(); observer?.disconnect(); interaction?.dispose(); camera?.dispose();
      disposeScene(this.scene); this.renderer.dispose(); if (!context.isContextLost()) this.renderer.forceContextLoss(); this.canvas.remove();
      throw error;
    }
  }

  private setStatus(status: SurfaceStatus): void {
    this.status = status;
    this.callbacks.onStatus(status);
  }
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
    this.interaction.clearHover();
    this.setStatus('lost');
  };
  private contextRestored = (): void => {
    this.perf.reset(true);
    this.setStatus('loading');
    this.invalidate();
    this.resize();
    this.wake();
  };
  private visibility = (): void => {
    if (document.hidden) { this.interaction.clearHover(); this.stop(); this.perf.reset(); }
    else { this.dirty = true; this.wake(); }
  };

  private resize = (): void => {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const rule = QUALITY[this._quality];
    const dpr = Math.min(devicePixelRatio * rule.scale, rule.dpr, Math.sqrt(rule.maxPixels / (width * height)));
    this.renderer.setDrawingBufferSize(width, height, dpr);
    this.camera.resize(width, height);
    this.weather.setQuality(rule.particles, dpr);
    this.dirty = true;
    this.wake();
  };

  get quality(): Quality { return this._quality; }
  setQuality(quality: Quality): void {
    this._quality = quality;
    const rule = QUALITY[quality];
    this.renderer.shadowMap.enabled = rule.shadow > 0;
    this.environment.setShadowMap(rule.shadow);
    this.environment.setDetail(rule.detail);
    this.buildings.setDetail(rule.detail);
    this.infrastructure.setDetail(rule.detail);
    this.traffic.setDetail(rule.actorShare);
    this.perf.reset();
    this.resize();
    this.invalidate();
  }
  setView(view: View): void { this.interaction.clearHover(); this.camera.setView(view); this.dirty = true; this.wake(); }
  focusDistrict(id: DistrictId): void { this.interaction.clearHover(); this.camera.focusDistrict(id); this.dirty = true; this.wake(); }
  focusBuilding(b: Building): void { this.interaction.clearHover(); this.camera.focusBuilding(b); this.dirty = true; this.wake(); }
  focusPoint(p: Point): void { this.interaction.clearHover(); this.camera.focusPoint(p); this.dirty = true; this.wake(); }
  select(building: Building | undefined): void { this.selected = building; this.interaction.showSelection(building); this.dirty = true; this.wake(); }
  invalidate(): void { this.dirty = this.forceState = true; this.wake(); }

  private canFrame(): boolean {
    return !this.destroyed && !this.suspended && !document.hidden && this.status !== 'lost' && this.status !== 'unavailable';
  }
  private wake = (): void => {
    if (!this.canFrame() || this.raf || this.inFrame) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  };
  private stop(): void { cancelAnimationFrame(this.raf); this.raf = this.last = 0; }
  suspend(): void { this.suspended = true; this.stop(); }
  restore(): void { this.suspended = false; this.dirty = true; this.wake(); }

  private frame = (now: number): void => {
    this.raf = 0;
    this.inFrame = true; this.rafTicks++;
    try {
      const needsFrame = this.draw(now);
      if (needsFrame && this.canFrame()) this.raf = requestAnimationFrame(this.frame);
    }
    catch (error) {
      console.error('City rendering stopped:', error);
      this.setStatus('unavailable');
    }
    finally { this.inFrame = false; }
  };

  private draw(now: number): boolean {
    const started = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const motion = this.sim.step(dt), minute = this.sim.minute;
    const cameraChanged = this.camera.update(dt);
    this.interaction.hover(now, cameraChanged);
    const weather = this.sim.weather;
    const transitioning = this.weather.rain !== Number(weather === 'rain') || this.weather.snow !== Number(weather === 'snow');
    const draw = this.dirty || motion > 0 || cameraChanged || transitioning;
    const camera = this.camera.camera;
    if (draw) {
      const canShadow = QUALITY[this._quality].shadow > 0 && minute >= 360 && minute <= 1080;
      const shadowChanged = this.environment.sun.castShadow !== canShadow;
      this.environment.sun.castShadow = canShadow;
      const updateShadow = this.forceState || shadowChanged || (Math.abs(minute - this.lastShadowMinute) > 2 && now > this.lastShadowAt + 740);
      this.environment.follow(camera);
      this.weather.update(weather, dt, this.sim.activeSeconds, camera);
      const night = this.environment.update(minute, this.sim.activeSeconds, this.weather.rain, this.weather.snow, updateShadow);
      this.buildings.setLight(night);
      this.infrastructure.setConditions(night, this.weather.rain, this.weather.snow);
      this.traffic.update(motion, this.sim, this.forceState);
      if (canShadow && updateShadow) {
        this.lastShadowAt = now; this.lastShadowMinute = minute;
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.renderer.info.reset();
      this.perf.begin(now);
      try { this.renderer.render(this.scene, camera); }
      finally { this.perf.end(now, performance.now() - started, canShadow && updateShadow); }
      if (this.status !== 'ready') this.setStatus('ready');
      this.lastVisual = now; this.renderedMinute = minute;
      this.dirty = this.forceState = false;
      if (cameraChanged || this.perf.frames === 1) this.callbacks.onCamera(camera.position, this.camera.orbit.target);
    }
    const still = !this.sim.playing && !this.camera.moving && !cameraChanged && !transitioning && now > this.lastVisual + 490;
    if (still || now > this.reportAt + 240) {
      this.reportAt = now;
      this.callbacks.onTelemetry({ metrics: this.perf.snapshot(now), actors: this.traffic.total, districtActors: this.traffic.counts });
    }
    return !still || this.interaction.hasPendingHover;
  }

  debugSnapshot() {
    let meshes = 0, instances = 0, trianglesRough = 0;
    this.scene.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      meshes++;
      const count = object instanceof T.InstancedMesh ? object.count : 1;
      instances += count;
      trianglesRough += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3 * count;
    });
    return {
      ...this.perf.snapshot(performance.now()), meshes, instances, trianglesRough, status: this.status, paused: !this.sim.playing, quality: this._quality,
      minute: this.sim.minute, renderedMinute: this.renderedMinute, rafTicks: this.rafTicks, frameRequested: !!this.raf,
      day: this.sim.day, speed: this.sim.rate, weather: this.sim.weather, mode: this.sim.mode,
      sceneRain: this.weather.rain, sceneSnow: this.weather.snow, activeEvent: this.sim.activeEvent?.id,
      sunIntensity: this.environment.sun.intensity, shadowSize: this.environment.sun.castShadow ? this.environment.sun.shadow.mapSize.x : 0,
      selected: this.selected?.id, moving: this.camera.moving, view: this.camera.camera.position.toArray(), target: this.camera.orbit.target.toArray(),
      actors: { ...this.traffic.total }, districtActors: Object.fromEntries(Object.entries(this.traffic.counts).map(([id, count]) => [id, { ...count }])),
      vehicle: { ...this.traffic.vehicleProbe }, pedestrian: { ...this.traffic.walkerProbe },
      buildings: this.layout.buildings.length, windows: this.buildings.windowCount, roads: this.layout.roads.length,
    };
  }

  debugTargets(): { id: string; x: number; y: number }[] {
    const rect = this.canvas.getBoundingClientRect(), results: { id: string; x: number; y: number }[] = [];
    this.camera.camera.updateMatrixWorld();
    for (const b of this.layout.buildings) {
      for (const altitude of [0.72, 0.47, 0.90]) {
        const p = this.projected.set(b.x, GROUND + b.height * altitude, b.z).project(this.camera.camera);
        if (Math.abs(p.x) > 0.90 || Math.abs(p.y) > 0.90 || p.z > 1) continue;
        const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2;
        if (this.interaction.pick(x, y)?.id === b.id && document.elementFromPoint(x, y) === this.canvas) {
          results.push({ id: b.id, x, y }); break;
        }
      }
      if (results.length >= 18) break;
    }
    return results;
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.events.abort();
    this.sizeObserver.disconnect();
    this.interaction.dispose();
    this.camera.dispose();
    this.perf.reset();
    disposeScene(this.scene);
    this.renderer.dispose();
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
