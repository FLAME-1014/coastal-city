import * as T from 'three';
import { GROUND, type Building } from '../city/layout';
import type { BuildingSystem } from './buildings';

export interface Hover { building: Building; x: number; y: number }

export class InteractionSystem {
  readonly group = new T.Group();
  private readonly events = new AbortController();
  private readonly state = new Map<number, { x: number; y: number; drag: boolean }>();
  private readonly ray = new T.Raycaster();
  private readonly cursor = new T.Vector2();
  private readonly intersections: T.Intersection[] = [];
  private readonly highlight: T.LineSegments<T.EdgesGeometry, T.LineBasicMaterial>;
  private lastHover = -Infinity;
  private pending: { x: number; y: number } | undefined;

  constructor(private canvas: HTMLCanvasElement, private camera: T.PerspectiveCamera, private buildings: BuildingSystem,
    private onSelect: (b: Building | undefined) => void, private onHover: (value: Hover | undefined) => void, private wake: () => void) {
    const cube = new T.BoxGeometry();
    this.highlight = new T.LineSegments(new T.EdgesGeometry(cube), new T.LineBasicMaterial({ color: 0x8cf4e9, transparent: true, opacity: 0.68 }));
    cube.dispose();
    this.highlight.visible = false;
    this.highlight.name = 'Selection bounds';
    this.group.add(this.highlight);
    const { signal } = this.events;
    canvas.addEventListener('pointerdown', this.down, { signal });
    canvas.addEventListener('pointermove', this.move, { signal });
    canvas.addEventListener('pointerup', this.up, { signal });
    canvas.addEventListener('pointerleave', this.leave, { signal });
    canvas.addEventListener('pointercancel', this.cancel, { signal });
    canvas.addEventListener('lostpointercapture', this.cancel, { signal });
  }

  private down = (e: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    this.state.set(e.pointerId, { x: e.clientX, y: e.clientY, drag: e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey });
    if (this.state.size > 1) for (const gesture of this.state.values()) gesture.drag = true;
    this.clearHover();
  };
  private move = (e: PointerEvent): void => {
    const gesture = this.state.get(e.pointerId);
    if (gesture && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 5) gesture.drag = true;
    if (e.pointerType === 'mouse' && !e.buttons) { this.pending = { x: e.clientX, y: e.clientY }; this.wake(); }
  };
  get hasPendingHover(): boolean { return this.pending !== undefined; }
  private up = (e: PointerEvent): void => {
    const gesture = this.state.get(e.pointerId);
    this.state.delete(e.pointerId);
    if (!gesture || gesture.drag || Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 5) return;
    this.onSelect(this.pick(e.clientX, e.clientY));
  };
  private cancel = (e: PointerEvent): void => { this.state.delete(e.pointerId); this.clearHover(); };
  private leave = (): void => this.clearHover();

  pick(x: number, y: number): Building | undefined {
    const rect = this.canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    this.cursor.set((x - rect.left) / rect.width * 2 - 1, (y - rect.top) / rect.height * -2 + 1);
    if (Math.abs(this.cursor.x) > 1 || Math.abs(this.cursor.y) > 1) return;
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.cursor, this.camera);
    this.intersections.length = 0;
    this.ray.intersectObjects(this.buildings.hitMeshes, false, this.intersections);
    const hit = this.intersections[0];
    return hit ? this.buildings.fromHit(hit) : undefined;
  }

  hover(now: number, cameraMoving: boolean): void {
    if (cameraMoving || !this.pending || now < this.lastHover + 64) return;
    const { x, y } = this.pending;
    this.pending = undefined;
    this.lastHover = now;
    const building = this.pick(x, y);
    this.canvas.style.cursor = building ? 'pointer' : '';
    this.onHover(building ? { building, x, y } : undefined);
  }
  clearHover(): void { this.pending = undefined; this.canvas.style.cursor = ''; this.onHover(undefined); }

  showSelection(building: Building | undefined): void {
    this.highlight.visible = !!building;
    if (!building) return;
    const { x, z, width, height, depth } = building;
    this.highlight.position.set(x, GROUND + height * 0.5, z);
    this.highlight.scale.set(width * 1.065, height + 1.4, depth * 1.065);
  }
  dispose(): void { this.events.abort(); this.state.clear(); this.pending = undefined; }
}
