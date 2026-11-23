import * as T from 'three';
import { random } from '../city/geometry';
import type { Weather } from '../city/simulation';

const vert = /* glsl */`
  uniform float uTime, uSnow, uDpr;
  uniform vec3 uCenter;
  varying float vFade;
  void main() {
    float n = fract(position.x * 24.329 + position.z * 52.011);
    float speed = mix(104.0, 16.0, uSnow) * (0.72 + n * 0.56);
    vec3 p;
    p.y = mod(position.y - uTime * speed, 340.0) - 150.0;
    p.x = mod(position.x - uTime * mix(13.0, 6.0, uSnow) + sin(uTime + n * 20.0) * uSnow * 7.0, 520.0) - 260.0;
    p.z = mod(position.z + uTime * mix(5.0, 2.0, uSnow), 520.0) - 260.0;
    vec4 view = viewMatrix * vec4(p + uCenter, 1.0);
    float t = mix(5000.0, 1900.0, uSnow) / max(50.0, -view.z);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uDpr * clamp(t, mix(4.0, 2.4, uSnow), mix(17.0, 8.5, uSnow));
    vFade = smoothstep(13.0, 64.0, -view.z) * (1.0 - smoothstep(530.0, 790.0, -view.z)) * smoothstep(-1.5, 6.0, p.y + uCenter.y);
  }
`;
const frag = /* glsl */`
  uniform float uOpacity, uSnow;
  varying float vFade;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float streak = (1.0 - smoothstep(0.025, 0.115, abs(p.x + 0.28 * p.y))) * (1.0 - smoothstep(0.17, 0.5, abs(p.y)));
    float flake = 1.0 - smoothstep(0.12, 0.47, length(p));
    float alpha = mix(streak * 0.69, flake * 0.87, uSnow) * uOpacity * vFade;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(mix(vec3(0.61, 0.75, 0.85), vec3(0.94, 0.97, 1.0), uSnow), alpha);
    #include <colorspace_fragment>
  }
`;

export class WeatherSystem {
  readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
  rain = 0;
  snow = 0;
  private count = 1600;
  private readonly center = new T.Vector3();
  private readonly forward = new T.Vector3();

  constructor(seed: number) {
    const geometry = new T.BufferGeometry();
    const rng = random(seed + 18), positions = new Float32Array(2400 * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = rng() * (i % 3 === 1 ? 340 : 520);
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    this.points = new T.Points(geometry, new T.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uSnow: { value: 0 }, uCenter: { value: this.center }, uDpr: { value: 1 } },
    }));
    this.points.name = 'Weather particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  setQuality(count: number, dpr: number): void {
    this.count = count;
    this.points.material.uniforms.uDpr!.value = dpr;
  }

  update(weather: Weather, dt: number, seconds: number, camera: T.Camera): void {
    const k = 1 - Math.exp(-dt * 3.8);
    const targetRain = weather === 'rain' ? 1 : 0, targetSnow = weather === 'snow' ? 1 : 0;
    this.rain += (targetRain - this.rain) * k;
    this.snow += (targetSnow - this.snow) * k;
    if (Math.abs(this.rain - targetRain) < 0.008) this.rain = targetRain;
    if (Math.abs(this.snow - targetSnow) < 0.008) this.snow = targetSnow;
    const amount = Math.min(1, this.rain + this.snow);
    this.points.visible = amount > 0.015;
    if (!this.points.visible) return;
    camera.getWorldDirection(this.forward);
    this.center.copy(camera.position).addScaledVector(this.forward, 233);
    const uniforms = this.points.material.uniforms;
    uniforms.uTime!.value = seconds;
    uniforms.uOpacity!.value = amount;
    uniforms.uSnow!.value = this.snow / (this.rain + this.snow);
    this.points.geometry.setDrawRange(0, Math.round(this.count * Math.min(1, 0.45 + amount)));
  }
}
