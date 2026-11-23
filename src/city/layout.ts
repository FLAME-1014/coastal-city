import { inPolygon, mix, random, roundedBlock, type Point, type TravelPath } from './geometry';

export const SEED = 20490817;
export const GROUND = 0.7;
export const ROAD_Y = 0.83;
export const DISTRICTS = [
  { id: 'bay', code: '01', name: '中央湾', en: 'CENTRAL BAY', x: 17, z: -104, color: '#76ddd5',
    summary: '南北主轴串起金融办公、高层公寓和潮汐广场。', view: [220, 222, 325] as const },
  { id: 'harbor', code: '02', name: '东岬港', en: 'EAST HARBOR', x: 264, z: 61, color: '#f1b873',
    summary: '滨水仓库、渡运站和开放码头沿外海布置。', view: [245, 185, 218] as const },
  { id: 'homes', code: '03', name: '白沙里', en: 'SAND QUARTER', x: -267, z: -126, color: '#9ebcff',
    summary: '低层公寓和社区服务围绕小尺度街区组织。', view: [-220, 228, 300] as const },
  { id: 'green', code: '04', name: '湿地海岸', en: 'WETLAND COAST', x: -147, z: 149, color: '#a4dc96',
    summary: '盐生林、海堤步道和气候站构成沿岸缓冲带。', view: [172, 151, 265] as const },
] as const;
export type DistrictId = typeof DISTRICTS[number]['id'];
export type Style = 'spire' | 'glass' | 'terrace' | 'housing' | 'shed' | 'civic';
export const STYLE_NAMES: Record<Style, string> = {
  spire: '地标塔楼', glass: '玻璃办公', terrace: '退台综合体', housing: '社区住宅', shed: '港区设施', civic: '公共设施',
};

export interface Building extends Point {
  id: string; name: string; district: DistrictId; style: Style; description: string;
  width: number; depth: number; height: number; floors: number; tint: number; landmark: boolean; solarKw: number;
}
export interface Road { a: Point; b: Point; width: number; artery: boolean }
export interface Block { id: string; x0: number; z0: number; x1: number; z1: number; district: DistrictId; green: boolean; plaza: boolean }
export interface Route { district: DistrictId; path: TravelPath }
export interface CityLayout {
  coast: readonly Point[]; buildings: readonly Building[]; roads: readonly Road[]; nodes: readonly Point[];
  blocks: readonly Block[]; vehicleRoutes: readonly Route[]; walkingRoutes: readonly Route[];
}

export const COAST: readonly Point[] = [
  [-435, -306], [-254, -328], [-65, -319], [135, -331], [304, -312], [367, -284],
  [410, -222], [421, -143], [392, -74], [421, -9], [422, 69], [388, 138], [347, 175],
  [299, 196], [253, 218], [211, 246], [142, 252], [84, 225], [31, 212], [-26, 224],
  [-86, 262], [-188, 285], [-294, 269], [-376, 231], [-431, 178], [-463, 92], [-466, -79], [-454, -213],
].map(([x, z]) => ({ x: x!, z: z! }));

const XS = [-375, -282, -188, -94, 0, 94, 188, 282, 354];
const ZS = [-250, -160, -70, 20, 104, 176];
export const SIDEWALK = 2.8;

function roadWidth(x: number, z: number, horizontal: boolean): number {
  return (horizontal ? z === -70 || z === 104 : x === 0 || x === 188) ? 15 : 11;
}
export function districtAt(x: number, z: number): DistrictId {
  if (x > 180 && z > -80) return 'harbor';
  if (z > 105 || (z > 20 && x < -210)) return 'green';
  return x < -158 ? 'homes' : 'bay';
}

type Landmark = { id: string; name: string; style: Style; height: number; tint: number; description: string };
const landmarks: Record<string, Landmark> = {
  '4:1:0': { id: 'QL-001', name: '潮汐之门', style: 'spire', height: 140, tint: 0x6ab0bb, description: '中央湾的最高点。逐层收分的主塔与屋顶观景灯标面向海湾。' },
  '3:1:3': { id: 'QL-002', name: '海镜塔', style: 'glass', height: 119, tint: 0x77a6c5, description: '玻璃幕墙办公塔，塔顶设备层和面朝广场的裙房可从空中辨认。' },
  '6:3:1': { id: 'QL-003', name: '环湾渡运站', style: 'shed', height: 26, tint: 0xca8f61, description: '东岬港的公共渡运枢纽，大跨屋盖为旅客提供候船空间。' },
  '1:1:1': { id: 'QL-004', name: '白沙社区公社', style: 'terrace', height: 41, tint: 0xd6be9b, description: '朝海的退台住宅与社区服务楼，屋面包含共享种植平台。' },
  '2:4:2': { id: 'QL-005', name: '海岸气候站', style: 'civic', height: 33, tint: 0x83bda5, description: '湿地观测和城市气候情景的展示站。当前读数由模拟生成。' },
  '4:3:0': { id: 'QL-006', name: '潮汐档案馆', style: 'civic', height: 30, tint: 0xc2b783, description: '广场东侧的公共档案馆，南侧连通海堤步道。' },
};

const palette: Record<Style, readonly number[]> = {
  spire: [0x81adb6, 0x8b9fad, 0x66a3a9], glass: [0x82a8ba, 0x67899e, 0x96b9ba, 0x9c9fb1],
  terrace: [0xc1c5af, 0xbdab8f, 0xb4c2be], housing: [0xd3d0be, 0xc0c4be, 0xc0a58e, 0xb2c0c8, 0xd3bc9e],
  shed: [0xb98a69, 0x92a7a6, 0xd4bd96, 0x72979a], civic: [0xd1d2bd, 0xa0b4a5, 0xb8a991],
};
const types: Record<DistrictId, readonly Style[]> = {
  bay: ['glass', 'glass', 'terrace', 'housing', 'spire', 'civic'],
  homes: ['housing', 'housing', 'housing', 'terrace', 'civic'],
  harbor: ['shed', 'shed', 'terrace', 'civic', 'glass'],
  green: ['civic', 'terrace', 'housing'],
};
const heights: Record<DistrictId, readonly [number, number]> = { bay: [30, 103], homes: [13, 43], harbor: [12, 44], green: [8, 23] };

export function generateCity(seed = SEED): CityLayout {
  const next = random(seed);
  const roads: Road[] = [], nodes: Point[] = [], blocks: Block[] = [], buildings: Building[] = [];
  const vehicleRoutes: Route[] = [], walkingRoutes: Route[] = [];
  const addRoad = (a: Point, b: Point, width: number) => {
    const horizontal = a.z === b.z, pad = width / 2 + SIDEWALK;
    const axis = horizontal ? 'z' : 'x';
    // Sample the full corridor across each edge, including the concave coast.
    for (let step = 0; step <= 8; step++) {
      const sample = { x: mix(a.x, b.x, step / 8), z: mix(a.z, b.z, step / 8) };
      if (!inPolygon({ ...sample, [axis]: sample[axis] - pad }, COAST)
        || !inPolygon({ ...sample, [axis]: sample[axis] + pad }, COAST)) return;
    }
    roads.push({ a, b, width, artery: width > 11 });
  };
  for (const [j, z] of ZS.entries()) for (const [i, x] of XS.entries()) {
    const a = { x, z }, east = XS[i + 1], south = ZS[j + 1];
    if (inPolygon(a, COAST)) nodes.push(a);
    if (east !== undefined) addRoad(a, { x: east, z }, roadWidth(x, z, true));
    if (south !== undefined) addRoad(a, { x, z: south }, roadWidth(x, z, false));
  }
  const roadKeys = new Set(roads.map(({ a, b }) => `${a.x}:${a.z}:${b.x}:${b.z}`));
  for (let j = 0; j < ZS.length - 1; j++) for (let i = 0; i < XS.length - 1; i++) {
    const x0 = XS[i]!, x1 = XS[i + 1]!, z0 = ZS[j]!, z1 = ZS[j + 1]!;
    if (![`${x0}:${z0}:${x1}:${z0}`, `${x0}:${z1}:${x1}:${z1}`, `${x0}:${z0}:${x0}:${z1}`, `${x1}:${z0}:${x1}:${z1}`].every(key => roadKeys.has(key))) continue;
    const district = districtAt((x0 + x1) / 2, (z0 + z1) / 2);
    const plaza = (i === 3 && j === 3) || (i === 6 && j === 4);
    const green = district === 'green' && (i + j) % 3 !== 0;
    const block: Block = { id: `${i}:${j}`, x0, z0, x1, z1, district, green, plaza };
    blocks.push(block);
    vehicleRoutes.push({ district, path: roundedBlock(x0 + 2.65, z0 + 2.65, x1 - 2.65, z1 - 2.65, 4.4) });
    const foot = (x: number, z: number, horizontal: boolean) => roadWidth(x, z, horizontal) / 2 + SIDEWALK / 2;
    walkingRoutes.push({ district, path: roundedBlock(x0 + foot(x0, z0, false), z0 + foot(x0, z0, true),
      x1 - foot(x1, z0, false), z1 - foot(x0, z1, true), 2.6) });
    for (let slot = 0; slot < 4; slot++) {
      const anchor = landmarks[`${block.id}:${slot}`];
      if (!anchor && (plaza || (green ? next() < 0.85 : next() < 0.045))) continue;
      const options = types[district], style = anchor?.style ?? options[Math.floor(next() * options.length)]!;
      const colors = palette[style];
      const footprint = style === 'shed' || style === 'civic' ? 0.74 : 0.60;
      const nominalW = ((x1 - x0) / 2 - 11) * (footprint + next() * 0.21);
      const nominalD = ((z1 - z0) / 2 - 11) * (footprint + next() * 0.23);
      const height = Math.round(anchor?.height ?? mix(...heights[district], Math.pow(next(), 1.35)));
      const cellX = (slot % 2 === 0 ? 0.31 : 0.69), cellZ = (slot < 2 ? 0.31 : 0.69);
      const id = anchor?.id ?? `Q-${district[0]?.toUpperCase()}${j + 1}${i + 1}${slot + 1}`;
      const districtName = DISTRICTS.find(d => d.id === district)!.name;
      const x = mix(x0, x1, cellX) + (next() - 0.5) * 4, z = mix(z0, z1, cellZ) + (next() - 0.5) * 3;
      // Reserve room for the widest arterial, sidewalk, and any plinth or roof overhang.
      const inset = 7.5 + SIDEWALK + 2.2;
      const width = Math.min(nominalW, (Math.min(x - x0, x1 - x) - inset) * 1.86);
      const depth = Math.min(nominalD, (Math.min(z - z0, z1 - z) - inset) * 1.86);
      buildings.push({
        id, name: anchor?.name ?? `${districtName} ${j + 1}${i + 1}-${slot + 1} 栋`, district, style,
        description: anchor?.description ?? `${districtName}的${STYLE_NAMES[style]}。楼层、屋顶和光伏容量为方案设定值。`,
        x, z,
        width, depth, height, floors: Math.floor(height / (style === 'shed' ? 5.1 : 3.6)),
        tint: anchor?.tint ?? colors[Math.floor(next() * colors.length)]!, landmark: !!anchor,
        solarKw: Math.round(width * depth * (style === 'shed' ? 0.12 : 0.045 + next() * 0.065)),
      });
    }
  }
  return { coast: COAST, buildings, roads, nodes, blocks, vehicleRoutes, walkingRoutes };
}

export function searchBuildings(buildings: readonly Building[], query: string): Building[] {
  const words = query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return buildings.filter(b => {
    const d = DISTRICTS.find(d => d.id === b.district)!;
    const haystack = `${b.name} ${b.id} ${d.name} ${d.en} ${STYLE_NAMES[b.style]}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}
