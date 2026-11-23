import { DISTRICTS, type Building, type CityLayout, type DistrictId } from '../city/layout';
import { clamp, type Point } from '../city/geometry';

const polyline = (points: readonly Point[]) => points.map(p => `${p.x},${p.z}`).join(' ');

export function minimapMarkup(layout: CityLayout): string {
  const roads = layout.roads.map(({ a, b }) => `M${a.x},${a.z}L${b.x},${b.z}`).join('');
  const footprints = layout.buildings.map(b => `M${Math.round(b.x - b.width / 2)},${Math.round(b.z - b.depth / 2)}h${Math.round(b.width)}v${Math.round(b.depth)}h${-Math.round(b.width)}Z`).join('');
  return `<svg id="city-map" viewBox="-490 -352 950 716" aria-label="栖潮市定位小地图" role="img">
    <defs><pattern id="map-grid" width="95" height="95" patternUnits="userSpaceOnUse"><path d="M95 0H0V95" stroke="#557a80" stroke-width="3" opacity=".30" fill="none"/></pattern></defs>
    <rect x="-490" y="-352" width="950" height="716" fill="url(#map-grid)"/>
    <polygon points="${polyline(layout.coast)}" fill="#294b4e" stroke="#719394" stroke-width="3"/>
    <path d="${roads}" fill="none" stroke="#709795" stroke-width="4" opacity=".60"/>
    <path d="${footprints}" fill="#b1c5ba" opacity=".67"/>
    <path d="M201 232v120m80-154v98m53-128v82" fill="none" stroke="#91a8a4" stroke-width="8"/>
    <g id="map-districts">${DISTRICTS.map(d => `<circle data-map-district="${d.id}" cx="${d.x}" cy="${d.z}" r="13" fill="${d.color}" stroke="#182d35" stroke-width="5"/>`).join('')}</g>
    <path id="map-bearing" d="M0 -3L-27 -59 27 -59Z" fill="#aaf4e3" opacity=".28" stroke="#aaf4e3" stroke-width="3"/>
    <circle id="map-target" cx="0" cy="0" r="12" fill="none" stroke="#aaf4e3" stroke-width="5"/>
    <circle id="map-building" cx="0" cy="0" r="18" fill="none" stroke="#fbd395" stroke-width="6" visibility="hidden"/>
  </svg>`;
}

export class MiniMap {
  private readonly svg: SVGSVGElement;
  private readonly target: SVGCircleElement;
  private readonly bearing: SVGPathElement;
  private readonly building: SVGCircleElement;
  constructor(root: HTMLElement, signal: AbortSignal, focus: (point: Point) => void, district: (id: DistrictId) => void) {
    this.svg = root.querySelector<SVGSVGElement>('#city-map')!;
    this.target = this.svg.querySelector<SVGCircleElement>('#map-target')!;
    this.bearing = this.svg.querySelector<SVGPathElement>('#map-bearing')!;
    this.building = this.svg.querySelector<SVGCircleElement>('#map-building')!;
    this.svg.addEventListener('click', e => {
      const id = (e.target as Element).getAttribute('data-map-district') as DistrictId | null;
      if (id) { district(id); return; }
      const matrix = this.svg.getScreenCTM();
      if (!matrix) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
      focus({ x: clamp(p.x, -475, 447), z: clamp(p.y, -340, 352) });
    }, { signal });
  }
  update(position: Point, aim: Point): number {
    const x = clamp(aim.x, -467, 435), z = clamp(aim.z, -333, 341);
    const angle = Math.atan2(aim.x - position.x, position.z - aim.z) * 180 / Math.PI;
    this.target.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)})`);
    this.bearing.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${angle.toFixed(1)})`);
    return angle;
  }
  select(building: Building | undefined): void {
    this.building.setAttribute('visibility', building ? 'visible' : 'hidden');
    if (building) this.building.setAttribute('transform', `translate(${building.x} ${building.z})`);
  }
  district(id: DistrictId | undefined): void {
    for (const el of this.svg.querySelectorAll('[data-map-district]')) {
      el.setAttribute('r', el.getAttribute('data-map-district') === id ? '21' : '13');
    }
  }
}
