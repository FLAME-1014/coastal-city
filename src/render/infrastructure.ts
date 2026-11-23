import * as T from 'three';
import { GROUND, ROAD_Y, SIDEWALK, type CityLayout } from '../city/layout';
import { inPolygon, random, type Point } from '../city/geometry';
import { Batch, flatPolygon } from './resources';

function offsetRing(ring: readonly Point[], offset: number): Point[] {
  return ring.map((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!, b = ring[(i + 1) % ring.length]!;
    const u = Math.hypot(p.x - a.x, p.z - a.z), v = Math.hypot(b.x - p.x, b.z - p.z);
    const x = (p.z - a.z) / u + (b.z - p.z) / v, z = -(p.x - a.x) / u - (b.x - p.x) / v;
    const l = Math.hypot(x, z) || 1;
    return { x: p.x + x / l * offset, z: p.z + z / l * offset };
  });
}

function band(a: readonly Point[], b: readonly Point[], y0: number, y1: number): T.BufferGeometry {
  const position = [], indices = [];
  for (const [i, p] of a.entries()) {
    position.push(p.x, y0, p.z, b[i]!.x, y1, b[i]!.z);
    const j = 2 * ((i + 1) % a.length), k = i * 2;
    indices.push(k, k + 1, j, j, k + 1, j + 1);
  }
  const geom = new T.BufferGeometry();
  geom.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export class Infrastructure {
  readonly group = new T.Group();
  private readonly detail = new T.Group();
  private readonly asphalt = new T.MeshStandardMaterial({ color: 0x515e5e, roughness: 0.92 });
  private readonly lamps = new T.MeshStandardMaterial({ color: 0xf4e4b3, emissive: 0xffbc6d, emissiveIntensity: 0.04 });
  private readonly dry = new T.Color(0x515e5e);
  private readonly wet = new T.Color(0x353f49);
  private readonly snowCover = new T.Color(0x7f9196);

  constructor(layout: CityLayout, seed: number) {
    this.group.name = 'Land, streets and landscape';
    this.group.add(this.detail);
    const { coast } = layout;
    const terrain = new T.Mesh(flatPolygon(coast), new T.MeshStandardMaterial({ color: 0x818e72, roughness: 1 }));
    terrain.position.y = GROUND;
    terrain.receiveShadow = true;
    this.group.add(terrain);
    const promenade = offsetRing(coast, -5), promenadeInside = offsetRing(coast, -12.5);
    const beachOuter = offsetRing(coast, 29), rocksOuter = offsetRing(coast, 5.7);
    const promenadeMesh = new T.Mesh(band(promenadeInside, promenade, GROUND + 0.035, GROUND + 0.035),
      new T.MeshStandardMaterial({ color: 0xb2b3a1, side: T.DoubleSide, roughness: 0.92 }));
    promenadeMesh.receiveShadow = true;
    const breakwater = new T.Mesh(band(coast, rocksOuter, GROUND - 0.002, -1.0),
      new T.MeshStandardMaterial({ color: 0xa19d85, side: T.DoubleSide }));
    const beach = new T.Mesh(band(rocksOuter, beachOuter, -1.0, -4.3),
      new T.MeshStandardMaterial({ color: 0xb9ac87, side: T.DoubleSide, roughness: 1 }));
    this.group.add(promenadeMesh, breakwater, beach);

    const rng = random(seed + 7);
    const cube = new T.BoxGeometry(), treeTop = new T.IcosahedronGeometry(1, 0), pineTop = new T.ConeGeometry(1, 1, 6);
    const cylinder = new T.CylinderGeometry(0.5, 0.5, 1, 8), delta = new T.ConeGeometry(0.55, 1, 5);
    const neutral = new T.MeshStandardMaterial({ roughness: 0.87 });
    const signs = new T.MeshStandardMaterial({ color: 0xded7ba, roughness: 0.91 });
    const paving = new Batch(cube, neutral), streets = new Batch(cube, this.asphalt), paint = new Batch(cube, signs);
    const trunks = new Batch(cube, neutral), leaves = new Batch(treeTop, neutral), conifers = new Batch(pineTop, neutral);
    const concrete = new Batch(cube, neutral), features = new Batch(cylinder, neutral), luminaires = new Batch(cube, this.lamps);
    const sails = new Batch(delta, neutral);
    const tree = (x: number, z: number, pine = false, size = 1) => {
      const h = (4.9 + rng() * 4.9) * size;
      trunks.add(x, GROUND + h * 0.26, z, h * 0.065, h * 0.52, h * 0.065, 0x615447);
      if (pine) {
        conifers.add(x, GROUND + h * 0.60, z, h * 0.26, h * 0.66, h * 0.23, 0x405d4a, rng() * 4);
        conifers.add(x, GROUND + h * 0.85, z, h * 0.17, h * 0.57, h * 0.16, 0x5e7b56, rng() * 4);
      } else {
        const shades = [0x5e855b, 0x749761, 0x497c62, 0x829660, 0x597e52];
        leaves.add(x, GROUND + h * 0.78, z, h * 0.35, h * 0.41, h * 0.33, shades[Math.floor(rng() * shades.length)], rng() * 6);
        if (rng() < 0.36) leaves.add(x + h * 0.23, GROUND + h * 0.75, z - h * 0.13, h * 0.19, h * 0.25, h * 0.21, 0x7d995f);
      }
    };
    const nodes = new Map<string, { x: number; z: number; hx: number; hz: number }>();
    for (const road of layout.roads) for (const p of [road.a, road.b]) {
      const key = `${p.x}:${p.z}`, node = nodes.get(key) ?? { ...p, hx: 0, hz: 0 };
      if (road.a.z === road.b.z) node.hz = road.width / 2;
      else node.hx = road.width / 2;
      nodes.set(key, node);
    }
    for (const node of nodes.values()) streets.add(node.x, ROAD_Y - 0.07, node.z, (node.hx || 5.5) * 2, 0.14, (node.hz || 5.5) * 2);
    const pole = (x: number, z: number) => {
      concrete.add(x, GROUND + 3.9, z, 0.37, 7.8, 0.37, 0x40535a);
      luminaires.add(x, GROUND + 7.8, z, 1.4, 0.28, 0.56);
    };
    for (const [i, { a, b, width, artery }] of layout.roads.entries()) {
      const horizontal = a.z === b.z, axis = horizontal ? 'x' : 'z', cross = horizontal ? 'z' : 'x';
      const tip = horizontal ? 'hx' : 'hz';
      const from = a[axis] + (nodes.get(`${a.x}:${a.z}`)![tip] || 5.5);
      const to = b[axis] - (nodes.get(`${b.x}:${b.z}`)![tip] || 5.5);
      const center = (from + to) / 2, len = to - from;
      const roadBox = (batch: Batch, s: number, o: number, y: number, length: number, w: number, h: number, color?: number) => {
        const z = a[cross] + o;
        batch.add(horizontal ? s : z, y, horizontal ? z : s, horizontal ? length : w, h, horizontal ? w : length, color);
      };
      roadBox(streets, center, 0, ROAD_Y - 0.07, len, width, 0.14);
      for (const d of [-1, 1]) roadBox(paving, center, d * (width / 2 + SIDEWALK / 2), 0.84, len, SIDEWALK, 0.17, 0xa4ada1);
      for (let t = from + 8; t < to - 5; t += artery ? 10 : 13) roadBox(paint, t, 0, ROAD_Y + 0.013, artery ? 4.6 : 2.9, 0.32, 0.024);
      if (artery) for (const t of [from + 2.5, to - 2.5]) {
        for (let o = -4.6; o < 5; o += 1.55) roadBox(paint, t, o, ROAD_Y + 0.014, 2.6, 0.57, 0.023);
      }
      if (artery || i % 3 === 0) {
        const crossAt = a[cross] + (width / 2 + 1);
        pole(horizontal ? center : crossAt, horizontal ? crossAt : center);
      }
    }
    for (const block of layout.blocks) {
      const { x0, x1, z0, z1, green, plaza, district } = block;
      const x = (x1 + x0) / 2, z = (z1 + z0) / 2, w = x1 - x0, d = z1 - z0;
      paving.add(x, 0.78, z, w - 15, 0.15, d - 15, 0xb3b8a7);
      paving.add(x, 0.82, z, w - 24, 0.19, d - 24,
        plaza ? 0xcac4af : green ? 0x78966a : district === 'harbor' ? 0xa7a897 : 0x9fae83);
      if (plaza) {
        const pool = district === 'harbor' ? 0x819fa2 : 0x539ca6;
        features.add(x, 1.28, z, 28, 0.60, 28, 0xddd2b6);
        features.add(x, 1.62, z, 25, 0.12, 25, pool);
        features.add(x, 3.94, z, 5.4, 5.0, 5.4, 0xcdd9c7);
        for (let i = -2; i <= 2; i++) {
          concrete.add(x + i * 7, 1.45, z - 21, 4.1, 0.85, 1.9, 0x7e8b74);
          if (i !== 0) tree(x + i * 10, z + 20, false, 1.07);
        }
      } else if (green) {
        paving.add(x, 0.94, z, w - 27, 0.073, 3.6, 0xc2bca0);
        paving.add(x, 0.94, z, 3.6, 0.073, d - 27, 0xc2bca0);
        for (let i = 0; i < 13; i++) {
          const tx = x + (rng() - 0.5) * (w - 30), tz = z + (rng() - 0.5) * (d - 28);
          if (Math.abs(tx - x) < 3.3 || Math.abs(tz - z) < 3.3 || layout.buildings.some(b => Math.abs(tx - b.x) < b.width / 2 + 4 && Math.abs(tz - b.z) < b.depth / 2 + 4)) continue;
          tree(tx, tz, rng() < 0.32, 1.1);
        }
      } else {
        for (const tx of [x - w * 0.27, x, x + w * 0.27]) {
          tree(tx, z0 + 13.2, rng() < 0.15, 0.81);
          if (rng() < 0.72) tree(tx + 1.2, z1 - 13.1, false, 0.85);
        }
      }
    }

    const shoreTrees = offsetRing(coast, -18);
    for (const [i, a] of shoreTrees.entries()) {
      const b = shoreTrees[(i + 1) % shoreTrees.length]!, len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let step = 7; step < len - 3; step += 14 + rng() * 10) {
        const t = step / len, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (inPolygon({ x, z }, coast) && !layout.buildings.some(p => Math.abs(p.x - x) < p.width / 2 + 8 && Math.abs(p.z - z) < p.depth / 2 + 8)) tree(x, z, rng() < 0.38);
      }
    }
    // Salt-tolerant groves and a viewing deck fill the wide strip behind the sea wall.
    for (const [cx, cz] of [[-365, 190], [-303, 226], [-250, 237], [-170, 237], [-96, 208], [-400, 123]] as const) {
      for (let i = 0; i < 18; i++) {
        const tx = cx + (rng() - 0.5) * 42, tz = cz + (rng() - 0.5) * 38;
        if (inPolygon({ x: tx, z: tz }, promenadeInside)) tree(tx, tz, rng() > 0.55, 0.58 + rng() * 0.55);
      }
    }
    paving.add(-184, 0.89, 205, 116, 0.38, 5.8, 0xbbb2a0);
    paving.add(-184, 0.90, 190, 5.8, 0.39, 30, 0xbbb2a0);
    features.add(-122, 1.30, 205, 14.5, 0.99, 14.5, 0xc3ad8a);
    features.add(-122, 1.83, 205, 7.5, 0.15, 7.5, 0x7fa1a0);
    // Piers share the port landfall; short side fingers create visible berth slips.
    for (const [x, begin, end] of [[201, 232, 352], [281, 198, 296], [334, 168, 250]] as const) {
      concrete.add(x, 0.72, (begin + end) / 2, 12, 1.1, end - begin, 0xb9b4a2);
      for (let z = begin + 18; z < end; z += 19) {
        concrete.add(x, 0.15, z, 2.7, 4.8, 2.7, 0x6f7d77);
        if (z < end - 7) concrete.add(x + 11, 0.43, z, 22, 0.72, 4.2, 0xaaa695);
      }
      for (const side of [-1, 1]) {
        concrete.add(x + side * 5.5, 1.37, (begin + end) / 2, 0.5, 0.82, end - begin, 0xe0d4b7);
        luminaires.add(x + side * 4.1, 1.9, end - 3, 0.8, 1.15, 0.8);
      }
      for (let z = begin + 24; z <= end - 9; z += 23) {
        const bx = x + 18 + rng() * 13;
        concrete.add(bx, -1.05, z + 7, 4.6, 1.52, 11.8, rng() < 0.4 ? 0x627c96 : 0xe2dbbe);
        sails.add(bx, 3.8, z + 7, 5.0, 9.2, 0.7, 0xe3dfc7);
      }
    }
    // Breakwater marker and small service sheds along the shoreline.
    features.add(199, 3.65, 348, 4.4, 6.2, 4.4, 0xe3d9b7);
    features.add(199, 6.5, 348, 4.9, 1.35, 4.9, 0xa8755d);
    luminaires.add(199, 7.5, 348, 2.2, 1, 2.2);
    paving.mount(this.group, 'Sidewalks, block surfaces and plazas');
    streets.mount(this.group, 'Asphalt');
    paint.mount(this.detail, 'Lane markings and crossings', false, false);
    leaves.mount(this.group, 'Deciduous trees', true);
    conifers.mount(this.group, 'Coastal conifers', true);
    trunks.mount(this.detail, 'Tree trunks');
    concrete.mount(this.group, 'Piers and street furniture', true);
    features.mount(this.group, 'Pools, fountains and pier beacon');
    sails.mount(this.detail, 'Sailboats');
    luminaires.mount(this.group, 'Street lights', false, false);
  }

  setConditions(night: number, rain: number, snow: number): void {
    this.lamps.emissiveIntensity = 0.04 + night * 2.0;
    this.asphalt.color.copy(this.dry).lerp(this.wet, rain * 0.9).lerp(this.snowCover, snow * 0.3);
    this.asphalt.roughness = 0.92 - rain * 0.46;
  }

  setDetail(enabled: boolean): void { this.detail.visible = enabled; }
}
