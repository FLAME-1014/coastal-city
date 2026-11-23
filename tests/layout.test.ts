import { describe, expect, it } from 'vitest';
import { inPolygon, samplePath } from '../src/city/geometry';
import { DISTRICTS, SEED, generateCity, searchBuildings } from '../src/city/layout';

describe('city plan', () => {
  const city = generateCity();
  it('regenerates a reproducible layout with stable addresses and six named landmarks', () => {
    expect(generateCity(SEED)).toEqual(city);
    expect(generateCity(SEED + 1).buildings).not.toEqual(city.buildings);
    expect(city.buildings.length).toBeGreaterThan(100);
    expect(new Set(city.buildings.map(b => b.id)).size).toBe(city.buildings.length);
    expect(city.buildings.filter(b => b.landmark)).toHaveLength(6);
    for (const d of DISTRICTS) expect(city.buildings.some(b => b.district === d.id)).toBe(true);
    expect(new Set(city.buildings.map(b => b.style)).size).toBe(6);
  });

  it('keeps every building inside a buildable block without crossing a road or footprint', () => {
    for (const [i, b] of city.buildings.entries()) {
      const block = city.blocks.find(p => b.x > p.x0 && b.x < p.x1 && b.z > p.z0 && b.z < p.z1)!;
      expect(block).toBeDefined();
      expect(block.plaza).toBe(false);
      expect(block.district).toBe(b.district);
      const [x0, x1] = [b.x - b.width / 2, b.x + b.width / 2];
      const [z0, z1] = [b.z - b.depth / 2, b.z + b.depth / 2];
      expect(Math.min(x0 - block.x0, block.x1 - x1, z0 - block.z0, block.z1 - z1)).toBeGreaterThan(12.3);
      for (const x of [x0, x1]) for (const z of [z0, z1]) expect(inPolygon({ x, z }, city.coast)).toBe(true);
      for (const c of city.buildings.slice(i + 1)) {
        expect(Math.abs(b.x - c.x) >= (b.width + c.width) / 2 || Math.abs(b.z - c.z) >= (b.depth + c.depth) / 2).toBe(true);
      }
    }
    expect(city.blocks.filter(b => b.plaza)).toHaveLength(2);
    expect(Math.max(...city.buildings.map(b => b.height))).toBe(140);
  });

  it('keeps all route samples on land and out of buildings, wrapping without a seam', () => {
    const pose = { x: 0, z: 0, heading: 0 };
    for (const { path } of [...city.vehicleRoutes, ...city.walkingRoutes]) {
      const first = { ...samplePath(path, 0, pose) };
      expect(samplePath(path, path.length * 17, pose)).toEqual(first);
      for (let i = 0; i < 60; i++) {
        const p = samplePath(path, path.length * i / 60, pose);
        expect(inPolygon(p, city.coast)).toBe(true);
        expect(city.buildings.some(b => Math.abs(p.x - b.x) < b.width / 2 && Math.abs(p.z - b.z) < b.depth / 2)).toBe(false);
        expect(Math.abs(p.heading)).toBeLessThanOrEqual(Math.PI);
      }
    }
  });

  it('matches normalized IDs, names and multiword district queries', () => {
    expect(searchBuildings(city.buildings, '  ｑｌ－００１  ').map(b => b.id)).toEqual(['QL-001']);
    expect(searchBuildings(city.buildings, '环湾渡运站').map(b => b.district)).toEqual(['harbor']);
    const matches = searchBuildings(city.buildings, 'central bay 玻璃办公');
    expect(matches.length).toBeGreaterThan(1);
    expect(matches.every(b => b.district === 'bay' && b.style === 'glass')).toBe(true);
    expect(searchBuildings(city.buildings, '无此建筑')).toEqual([]);
  });
});
