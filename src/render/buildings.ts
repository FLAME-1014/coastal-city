import * as T from 'three';
import { DISTRICTS, GROUND, type Building, type CityLayout } from '../city/layout';
import { clamp, random } from '../city/geometry';
import { FacadeBatch, facadeMaterial } from './facades';
import { Batch } from './resources';

export class BuildingSystem {
  readonly group = new T.Group();
  readonly byId: ReadonlyMap<string, Building>;
  readonly hitMeshes: T.InstancedMesh[] = [];
  readonly windowCount: number;
  private readonly accents = new T.Group();
  private readonly windows: [T.MeshStandardMaterial, T.MeshStandardMaterial];
  private readonly ids = new Map<T.Object3D, readonly Building[]>();

  constructor(layout: CityLayout, seed: number) {
    this.group.name = 'Buildings';
    this.byId = new Map(layout.buildings.map(b => [b.id, b]));
    this.group.add(this.accents);
    const cube = new T.BoxGeometry();
    const octagon = new T.CylinderGeometry(0.54, 0.54, 1, 8);
    const peak = new T.CylinderGeometry(0.12, 0.53, 1, 6);
    const capShape = new T.Shape().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.34, 0.48).lineTo(-0.36, 0.48).closePath();
    const roof = new T.ExtrudeGeometry(capShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
    const solid = new T.MeshStandardMaterial({ roughness: 0.72 });
    const glass = new T.MeshStandardMaterial({ roughness: 0.41, metalness: 0.14 });
    const trim = new T.MeshStandardMaterial({ roughness: 0.67 });
    this.windows = [facadeMaterial(seed + 331, true), facadeMaterial(seed + 221, false)];
    const rng = random(seed + 602);
    let count = 0;
    for (const district of DISTRICTS) {
      const districtGroup = new T.Group();
      districtGroup.name = district.name;
      this.group.add(districtGroup);
      const box = new Batch(cube, solid), glazing = new Batch(cube, glass), round = new Batch(octagon, solid);
      const spires = new Batch(peak, glass), roofs = new Batch(roof, solid);
      const details = new Batch(cube, trim), solar = new Batch(cube, glass);
      const towers = new FacadeBatch(), studios = new FacadeBatch();
      const pickSets = new Map<Batch, Building[]>();
      const part = (batch: Batch, b: Building, x: number, bottom: number, z: number, w: number, h: number, d: number, tint = b.tint) => {
        const ids = pickSets.get(batch) ?? [];
        if (!ids.length) pickSets.set(batch, ids);
        ids.push(b);
        batch.add(x, GROUND + bottom + h / 2, z, w, h, d, tint);
      };
      const facade = (b: Building, x: number, start: number, z: number, w: number, h: number, d: number, tall: boolean) => {
        const rows = clamp(Math.floor(h / (tall ? 5.3 : 4.1)), 1, b.landmark ? 18 : 16), step = tall ? 4.0 : 5.2;
        count += (tall ? towers : studios).add(x, GROUND + start, z, w, h, d, rows,
          clamp(Math.round(w / step), 2, 8), clamp(Math.round(d / step), 2, 8), Math.floor(rng() * 16));
      };
      for (const b of layout.buildings) {
        if (b.district !== district.id) continue;
        const { x, z, width: w, depth: d, height: h } = b;
        details.add(x, GROUND + 0.36, z, w + 4, 0.72, d + 4, 0xb1b6aa);
        if (b.style === 'spire') {
          part(box, b, x, 0, z, w, h * 0.15, d, 0xa3b3ae);
          part(glazing, b, x, h * 0.15, z, w * 0.86, h * 0.60, d * 0.86);
          facade(b, x, h * 0.15, z, w * 0.86, h * 0.60, d * 0.86, true);
          part(glazing, b, x, h * 0.75, z - 0.6, w * 0.64, h * 0.16, d * 0.68);
          facade(b, x, h * 0.75, z - 0.6, w * 0.64, h * 0.16, d * 0.68, true);
          part(spires, b, x, h * 0.91, z - 0.6, w * 0.56, h * 0.09, d * 0.62, 0xb3d7d3);
          for (const side of [-1, 1]) details.add(x + side * w * 0.41, GROUND + h * 0.45, z, 0.65, h * 0.6, d * 0.92, 0xc1c7ba);
        } else if (b.style === 'glass') {
          part(box, b, x, 0, z, w, h * 0.12, d, 0xb9baaf);
          part(glazing, b, x, h * 0.12, z, w * 0.89, h * 0.84, d * 0.88);
          facade(b, x, h * 0.12, z, w * 0.89, h * 0.84, d * 0.88, true);
          part(box, b, x, h * 0.96, z, w * 0.57, h * 0.04, d * 0.59, 0xd2d0bd);
          for (const side of [-1, 1]) details.add(x + side * w * 0.45, GROUND + h * 0.55, z, 0.58, h * 0.85, d * 0.92, 0xb6c5be);
        } else if (b.style === 'terrace') {
          let bottom = 0;
          for (let level = 0; level < 3; level++) {
            const scale = 1 - level * 0.16, depth = d * scale, center = z - level * d * 0.05;
            const tier = h * [0.49, 0.30, 0.21][level]!;
            part(box, b, x, bottom, center, w * scale, tier, depth);
            facade(b, x, bottom, center, w * scale, tier, depth, false);
            details.add(x, GROUND + bottom + tier - 0.1, center + depth * 0.34, w * scale * 0.88, 0.6, depth * 0.18, 0x72957b);
            bottom += tier;
          }
        } else if (b.style === 'shed') {
          part(box, b, x, 0, z, w, h * 0.79, d);
          facade(b, x, h * 0.10, z, w, h * 0.55, d, false);
          part(roofs, b, x, h * 0.79, z, w * 1.035, h * 0.21, d * 1.025, b.landmark ? 0xd79c6a : 0xb4b9a9);
          for (let i = 0; i < 4; i++) solar.add(x, GROUND + h + 0.12, z + (i - 1.5) * d * 0.19, w * 0.51, 0.3, d * 0.14, 0x315b70);
        } else if (b.style === 'civic') {
          part(box, b, x, 0, z, w, h * 0.23, d, 0xaaa99b);
          facade(b, x, 0.3, z, w, h * 0.20, d, true);
          part(round, b, x, h * 0.23, z, w * 0.93, h * 0.44, d * 0.93);
          part(round, b, x, h * 0.67, z, w * 0.935, h * 0.10, d * 0.935, 0x64899a);
          part(round, b, x, h * 0.77, z, w * 0.945, h * 0.10, d * 0.945, b.tint);
          part(round, b, x, h * 0.87, z, w, h * 0.13, d, b.landmark ? 0xc7dcc2 : 0xd1c6ac);
          details.add(x, GROUND + h + 1.2, z, 1, 2.5, 1, 0x809fa1);
        } else {
          part(box, b, x, 0, z, w, h * 0.96, d);
          facade(b, x, 0.6, z, w, h * 0.90, d, false);
          part(box, b, x, h * 0.96, z, w * 0.58, h * 0.04, d * 0.56, 0xe0d4ba);
          for (let i = 1; i < 4; i++) details.add(x, GROUND + h * i / 4, z + d * 0.50, w, 0.42, 0.85, 0xe0d8c4);
          solar.add(x, GROUND + h + 0.12, z, w * 0.31, 0.28, d * 0.4, 0x455e6d);
        }
      }
      for (const [batch, ids] of pickSets) {
        const mesh = batch.mount(districtGroup, `Structure · ${district.id}`, true);
        if (mesh) { this.hitMeshes.push(mesh); this.ids.set(mesh, ids); }
      }
      details.mount(this.accents, `Trim · ${district.id}`);
      solar.mount(this.accents, `Roof PV · ${district.id}`);
      towers.mount(districtGroup, this.windows[0], `Tower facades · ${district.id}`);
      studios.mount(districtGroup, this.windows[1], `Neighborhood facades · ${district.id}`);
    }
    this.windowCount = count;
  }

  fromHit(hit: T.Intersection): Building | undefined {
    return hit.instanceId === undefined ? undefined : this.ids.get(hit.object)?.[hit.instanceId];
  }

  setLight(night: number): void { for (const material of this.windows) material.emissiveIntensity = 0.03 + night * 1.25; }
  setDetail(enabled: boolean): void { this.accents.visible = enabled; }
}
