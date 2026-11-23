import * as T from 'three';
import { random } from '../city/geometry';

const COLS = 8, ROWS = 16, CELL = 14;

/** Two shared atlases, with a separately baked occupancy mask for night lighting. */
export function facadeMaterial(seed: number, tall: boolean): T.MeshStandardMaterial {
  const w = COLS * CELL, h = ROWS * CELL;
  const tint = new Uint8Array(w * h * 4), emissive = new Uint8Array(tint.length);
  const rng = random(seed);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const shade = 66 + rng() * 48, glow = rng() < 0.35 ? 0.53 + rng() * 0.47 : 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const i = ((row * CELL + y) * w + col * CELL + x) * 4;
      const u = x / CELL, v = y / CELL;
      const pane = u >= (tall ? 0.11 : 0.24) && u <= (tall ? 0.87 : 0.76) && v > (tall ? 0.16 : 0.24) && v < (tall ? 0.86 : 0.78);
      // Top half of the glass reflects a little more sky.
      const value = shade + (v > 0.48 ? 13 : 0);
      tint[i] = value * 0.74; tint[i + 1] = value; tint[i + 2] = value * 1.20;
      tint[i + 3] = pane ? 255 : 0;
      emissive[i] = emissive[i + 1] = emissive[i + 2] = Math.round(glow * (u > 0.30 ? 255 : 207));
      emissive[i + 3] = 255;
    }
  }
  const texture = (pixels: Uint8Array) => {
    const map = new T.DataTexture(pixels, w, h);
    map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.minFilter = T.LinearMipmapLinearFilter;
    map.magFilter = T.LinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 4;
    map.needsUpdate = true;
    return map;
  };
  return new T.MeshStandardMaterial({ map: texture(tint), emissiveMap: texture(emissive), emissive: 0xffbd79,
    emissiveIntensity: 0.03, alphaTest: 0.48, roughness: tall ? 0.43 : 0.58 });
}

/** One quad per exterior wall, with one UV cell per original window. */
export class FacadeBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  add(x: number, y: number, z: number, width: number, height: number, depth: number, rows: number, colsWide: number, colsNarrow: number, offset: number): number {
    let count = 0;
    for (let side = 0; side < 4; side++) {
      const nx = [0, 1, 0, -1][side]!, nz = [1, 0, -1, 0][side]!;
      const half = (side % 2 === 0 ? width : depth) / 2 * 0.95;
      const reach = (side % 2 === 0 ? depth : width) / 2 + 0.075;
      const columns = side % 2 === 0 ? colsWide : colsNarrow;
      const px = x + nx * reach, pz = z + nz * reach, base = this.positions.length / 3;
      for (const [u, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const) {
        this.positions.push(px + nz * u * half, y + v * height, pz - nx * u * half);
        this.normals.push(nx, 0, nz);
        this.uvs.push((offset + side + (u === -1 ? 0 : columns)) / COLS, (offset * 3 + v * rows) / ROWS);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      count += rows * columns;
    }
    return count;
  }

  mount(root: T.Object3D, material: T.MeshStandardMaterial, name: string): void {
    if (!this.indices.length) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = name;
    root.add(mesh);
  }
}
