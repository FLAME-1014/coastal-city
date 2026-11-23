import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, type Point } from '../city/geometry';
import { DISTRICTS, type Building, type DistrictId } from '../city/layout';

export const VIEWS = [
  { id: 'orbit', name: '全景' }, { id: 'plan', name: '俯瞰' },
  { id: 'coast', name: '海岸' }, { id: 'street', name: '街道' },
] as const;
export type View = typeof VIEWS[number]['id'];

type Vec3 = readonly [number, number, number];
const homeTarget: Vec3 = [4, 4, 35];
const homeOffset: Vec3 = [505, 558, 590];
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const isControl = (element: EventTarget | null) => element instanceof Element && !!element.closest('button, a, input, select, textarea, [contenteditable="true"], summary, dialog');

export class CameraController {
  readonly camera = new T.PerspectiveCamera(45, 1.65, 1.2, 7500);
  readonly orbit: OrbitControls;
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  private readonly forward = new T.Vector3();
  private readonly sideways = new T.Vector3();
  private readonly move = new T.Vector3();
  private flight: { elapsed: number; lift: number; from: T.Vector3; to: T.Vector3; startTarget: T.Vector3; target: T.Vector3 } | undefined;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private moved = false;

  constructor(canvas: HTMLCanvasElement, private readonly onHandsOn: () => void, private readonly wake: () => void) {
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.11;
    this.orbit.minDistance = 10;
    this.orbit.maxDistance = 2600;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.012;
    this.orbit.screenSpacePanning = false;
    this.orbit.zoomSpeed = 0.85;
    this.orbit.addEventListener('start', this.startOrbit);
    this.orbit.addEventListener('change', this.markMoved);
    const { signal } = this.events;
    window.addEventListener('keydown', this.keyDown, { signal });
    window.addEventListener('keyup', this.keyUp, { signal });
    window.addEventListener('blur', this.clearKeys, { signal });
    document.addEventListener('visibilitychange', this.clearKeys, { signal });
    canvas.addEventListener('pointerdown', this.cancelFlight, { signal, capture: true });
    this.setView('orbit', true);
  }

  get moving(): boolean { return !!this.flight; }
  dispose(): void { this.events.abort(); this.orbit.dispose(); this.keys.clear(); }
  private markMoved = (): void => { this.moved = true; this.wake(); };
  private clearKeys = (): void => { this.keys.clear(); };
  private startOrbit = (): void => { this.cancelFlight(); this.onHandsOn(); this.wake(); };
  private cancelFlight = (): void => {
    if (!this.flight) return;
    this.flight = undefined;
    this.orbit.enableDamping = true;
  };

  private keyDown = (ev: KeyboardEvent): void => {
    if (isControl(ev.target) || ev.ctrlKey || ev.altKey || ev.metaKey || !movementKeys.has(ev.code)) return;
    if (!ev.code.startsWith('Shift')) ev.preventDefault();
    this.keys.add(ev.code);
    if (!ev.repeat && !ev.code.startsWith('Shift')) { this.cancelFlight(); this.onHandsOn(); this.wake(); }
  };
  private keyUp = (ev: KeyboardEvent): void => { this.keys.delete(ev.code); };

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.moved = true;
  }

  private fly(center: Vec3, offset: Vec3, fit: boolean, instant = false): void {
    this.orbit.enableDamping = false;
    this.orbit.update(); // Drain residual OrbitControls inertia before interpolating.
    const target = new T.Vector3(...center);
    const scale = fit ? clamp(1.56 / this.camera.aspect, 0.80, 1.95) : 1;
    const to = new T.Vector3(...offset).multiplyScalar(scale).add(target);
    if (instant || this.reducedMotion) {
      this.flight = undefined;
      this.camera.position.copy(to);
      this.orbit.target.copy(target);
      this.orbit.update();
      this.orbit.enableDamping = true;
      this.moved = true;
    } else {
      const from = this.camera.position.clone();
      const lift = Math.min(78, from.distanceTo(to) * 0.08);
      this.flight = { elapsed: 0, lift, from, to, startTarget: this.orbit.target.clone(), target };
    }
  }

  setView(view: View, instant = false): void {
    if (view === 'plan') this.fly([-18, 0, -21], [0, 1050, 47], true, instant);
    else if (view === 'coast') this.fly([30, 29, 35], [540, 118, 560], true, instant);
    else if (view === 'street') this.fly([24, 9, -96], [-22, 5, 81], false, instant);
    else this.fly(homeTarget, homeOffset, true, instant);
  }

  focusDistrict(id: DistrictId): void {
    const d = DISTRICTS.find(item => item.id === id)!;
    this.fly([d.x, 13, d.z], d.view, true);
  }
  focusBuilding(b: Building): void {
    const r = Math.max(b.height * 1.3, 68);
    this.fly([b.x, b.height * 0.41, b.z], [r * 0.77, r * 0.52, r * 1.16], true);
  }
  focusPoint(p: Point): void { this.fly([p.x, 6, p.z], [206, 157, 254], true); }

  update(dt: number): boolean {
    if (this.flight) {
      const f = this.flight;
      f.elapsed = Math.min(1, f.elapsed + dt / 0.83);
      const t = f.elapsed * f.elapsed * (3 - 2 * f.elapsed);
      this.camera.position.lerpVectors(f.from, f.to, t);
      this.camera.position.y += Math.sin(t * Math.PI) * f.lift;
      this.orbit.target.lerpVectors(f.startTarget, f.target, t);
      if (f.elapsed === 1) this.cancelFlight();
    } else if (this.keys.size) {
      const has = (...values: string[]) => values.some(v => this.keys.has(v));
      const z = Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown'));
      const x = Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft'));
      const y = Number(has('KeyE')) - Number(has('KeyQ'));
      this.camera.getWorldDirection(this.forward);
      this.forward.y = 0;
      this.forward.normalize();
      this.sideways.set(-this.forward.z, 0, this.forward.x);
      this.move.copy(this.forward).multiplyScalar(z).addScaledVector(this.sideways, x);
      this.move.y = y;
      const speed = clamp(this.orbit.getDistance() * 0.58, 34, 260) * (has('ShiftLeft', 'ShiftRight') ? 2 : 1);
      this.move.normalize().multiplyScalar(speed * dt);
      this.translateWithinBounds();
    }
    this.orbit.update(dt);
    // Mouse/touch panning can move the orbit target beyond the walkable chart.
    const t = this.orbit.target;
    this.move.set(clamp(t.x, -590, 560) - t.x, clamp(t.y, 0, 240) - t.y, clamp(t.z, -460, 465) - t.z);
    if (this.move.lengthSq() > 0) this.translateWithinBounds();
    if (this.camera.position.y < 1.9) {
      this.camera.position.y = 1.9;
      this.camera.lookAt(t);
      this.moved = true;
    }
    const changed = this.moved;
    this.moved = false;
    return changed;
  }

  private translateWithinBounds(): void {
    const p = this.camera.position, t = this.orbit.target;
    this.move.x = clamp(t.x + this.move.x, -590, 560) - t.x;
    this.move.y = clamp(this.move.y, Math.max(1.35 - p.y, -t.y), Math.min(2100 - p.y, 240 - t.y));
    this.move.z = clamp(t.z + this.move.z, -460, 465) - t.z;
    if (!this.move.lengthSq()) return;
    p.add(this.move); t.add(this.move);
    this.orbit.update();
    this.moved = true;
  }
}
