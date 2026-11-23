import * as T from 'three';
import { DISTRICTS, ROAD_Y, type CityLayout, type DistrictId, type Route } from '../city/layout';
import { random, samplePath, wrap, type PathPose } from '../city/geometry';
import { mobility, type Simulation, type Mobility } from '../city/simulation';

interface Actor { route: Route; distance: number; speed: number; slot: number; color: T.Color; size: number }
export interface Count { vehicles: number; pedestrians: number }
const DISTRICT_KEYS = DISTRICTS.map(d => d.id);
const perDistrict = <V>(create: () => V): Record<DistrictId, V> => ({ bay: create(), harbor: create(), homes: create(), green: create() });
const zero = (): Count => ({ vehicles: 0, pedestrians: 0 });

export class TrafficSystem {
  readonly group = new T.Group();
  readonly counts = perDistrict(zero);
  readonly total = zero();
  readonly vehicleProbe: PathPose = { x: 0, z: 0, heading: 0 };
  readonly walkerProbe: PathPose = { x: 0, z: 0, heading: 0 };
  private readonly vehicles: Actor[];
  private readonly people: Actor[];
  private readonly body: T.InstancedMesh;
  private readonly roof: T.InstancedMesh;
  private readonly chassis: T.InstancedMesh;
  private readonly shirts: T.InstancedMesh;
  private readonly heads: T.InstancedMesh;
  private readonly detail = new T.Group();
  private readonly modifier = perDistrict<Mobility>(() => mobility('bay', 540, 'clear'));
  private readonly pose: PathPose = { x: 0, z: 0, heading: 0 };
  private readonly transform = new T.Object3D();
  private accumulator = 0;
  private detailShare = 1;

  constructor(layout: CityLayout, seed: number) {
    this.group.name = 'Traffic and pedestrians';
    this.group.add(this.detail);
    const rng = random(seed + 520);
    const init = (routes: readonly Route[], n: number, isCar: boolean): Actor[] => routes.flatMap(route => {
      const start = rng() * route.path.length;
      const speed = isCar ? 8.1 + rng() * 3.4 : 1.24 + rng() * 0.54;
      const colors = isCar ? [0xffd078, 0xffffff, 0x74c1d9, 0xe48767, 0x507e9d, 0xe7d7bc] : [0xd89c6e, 0x5abfa4, 0xe0debd, 0x537ea5, 0xd9857b];
      return Array.from({ length: n }, (_, i) => ({ route, distance: start + i * route.path.length / n,
        speed, slot: (i + 0.28 + rng() * 0.42) / n, size: 0.85 + rng() * 0.28,
        color: new T.Color(colors[Math.floor(rng() * colors.length)]!), }));
    });
    this.vehicles = init(layout.vehicleRoutes, 3, true);
    this.people = init(layout.walkingRoutes, 5, false);
    const cube = new T.BoxGeometry(), head = new T.IcosahedronGeometry(0.32, 0);
    const material = new T.MeshStandardMaterial({ roughness: 0.66 });
    const assembly = (parent: T.Object3D, name: string, geometry: T.BufferGeometry, material: T.Material, n: number) => {
      const layer = new T.InstancedMesh(geometry, material, n);
      layer.name = name;
      layer.instanceMatrix.setUsage(T.DynamicDrawUsage);
      layer.count = 0;
      layer.frustumCulled = false;
      parent.add(layer);
      return layer;
    };
    this.body = assembly(this.group, 'Vehicle bodies', cube, material, this.vehicles.length);
    this.roof = assembly(this.group, 'Vehicle glazing', cube, new T.MeshStandardMaterial({ color: 0x486376, roughness: 0.4 }), this.vehicles.length);
    this.chassis = assembly(this.detail, 'Vehicle wheels and contact', cube, new T.MeshStandardMaterial({ color: 0x32393d }), this.vehicles.length);
    this.shirts = assembly(this.group, 'Pedestrian coats', cube, material, this.people.length);
    this.heads = assembly(this.detail, 'Pedestrian heads', head, new T.MeshStandardMaterial({ color: 0xe3b99b }), this.people.length);
    for (const [i, a] of this.vehicles.entries()) this.body.setColorAt(i, a.color);
    for (const [i, a] of this.people.entries()) this.shirts.setColorAt(i, a.color);
  }

  setDetail(share: number): void {
    this.detailShare = share;
    this.detail.visible = share >= 0.85;
  }

  private matrix(target: T.InstancedMesh, i: number, y: number, w: number, h: number, d: number, longitudinal = 0): void {
    const p = this.pose;
    this.transform.position.set(p.x + Math.sin(p.heading) * longitudinal, y, p.z + Math.cos(p.heading) * longitudinal);
    this.transform.rotation.y = p.heading;
    this.transform.scale.set(w, h, d);
    this.transform.updateMatrix();
    target.setMatrixAt(i, this.transform.matrix);
  }

  update(motion: number, sim: Simulation, force = false): boolean {
    this.accumulator += motion;
    if (!force && this.accumulator < 1 / 30) return false;
    const dt = this.accumulator;
    this.accumulator = 0;
    for (const id of DISTRICT_KEYS) {
      mobility(id, sim.minute, sim.weather, this.modifier[id]);
      this.counts[id].vehicles = this.counts[id].pedestrians = 0;
    }
    let vehicles = 0, pedestrians = 0;
    for (const actor of this.vehicles) {
      const m = this.modifier[actor.route.district];
      actor.distance = wrap(actor.distance + dt * actor.speed * m.vehicleSpeed, actor.route.path.length);
      if (actor.slot >= m.vehicleShare * this.detailShare) continue;
      samplePath(actor.route.path, actor.distance, this.pose);
      if (vehicles === 0) Object.assign(this.vehicleProbe, this.pose);
      this.counts[actor.route.district].vehicles++;
      const s = actor.size;
      this.matrix(this.body, vehicles, ROAD_Y + 0.64, 2.26 * s, 0.88, 4.85 * s);
      this.matrix(this.roof, vehicles, ROAD_Y + 1.25, 1.94 * s, 0.52, 2.73 * s, -0.16);
      if (this.detail.visible) this.matrix(this.chassis, vehicles, ROAD_Y + 0.23, 2.31 * s, 0.36, 3.50 * s);
      this.body.setColorAt(vehicles++, actor.color);
    }
    for (const actor of this.people) {
      const m = this.modifier[actor.route.district];
      actor.distance = wrap(actor.distance + dt * actor.speed * m.walkingSpeed, actor.route.path.length);
      if (actor.slot >= m.walkingShare * this.detailShare) continue;
      samplePath(actor.route.path, actor.distance, this.pose);
      if (pedestrians === 0) Object.assign(this.walkerProbe, this.pose);
      this.counts[actor.route.district].pedestrians++;
      const scale = actor.size, y = ROAD_Y + 0.02 + Math.sin(actor.distance * 8) * 0.085;
      this.matrix(this.shirts, pedestrians, y + scale * 0.87, 0.65 * scale, 1.7 * scale, 0.47 * scale);
      if (this.detail.visible) this.matrix(this.heads, pedestrians, y + scale * 1.85, scale, scale, scale);
      this.shirts.setColorAt(pedestrians++, actor.color);
    }
    this.total.vehicles = vehicles; this.total.pedestrians = pedestrians;
    this.body.count = this.roof.count = this.chassis.count = vehicles;
    this.shirts.count = this.heads.count = pedestrians;
    this.body.instanceMatrix.needsUpdate = this.roof.instanceMatrix.needsUpdate = this.shirts.instanceMatrix.needsUpdate = true;
    if (this.detail.visible) this.chassis.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.shirts.instanceColor) this.shirts.instanceColor.needsUpdate = true;
    return true;
  }
}
