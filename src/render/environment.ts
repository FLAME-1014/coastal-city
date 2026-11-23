import * as T from 'three';
import { mix, random } from '../city/geometry';
import { solarAt } from '../city/simulation';
import { Batch } from './resources';

const skyVert = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;
const skyFrag = /* glsl */`
  uniform vec3 uZenith, uHorizon, uSun;
  uniform float uNight, uCloud, uTwilight, uTime;
  varying vec3 vDirection;
  float hash(vec2 n) { return fract(sin(dot(n, vec2(41.7, 73.1))) * 21324.917); }
  void main() {
    vec3 ray = normalize(vDirection);
    float y = max(0.0, ray.y);
    vec3 col = mix(uHorizon, uZenith, pow(y, 0.48));
    float sun = max(0.0, dot(ray, uSun));
    col += vec3(0.48, 0.23, 0.08) * pow(sun, 13.0) * (uTwilight * 0.85 + 0.12) * (1.0 - uCloud);
    col += vec3(1.0, 0.78, 0.45) * smoothstep(0.99955, 0.99984, sun) * (1.0 - uNight) * (1.0 - uCloud);
    if (y > 0.05) {
      vec2 p = ray.xz / max(0.26, y + 0.16);
      float haze = sin(p.x * 7.4 + p.y * 5.5 + uTime * 0.006)
                 + 0.55 * sin(p.x * 19.7 - p.y * 16.4 - uTime * 0.01)
                 + 0.19 * sin(p.x * 38.0 + p.y * 15.4);
      float cloud = smoothstep(1.18 - uCloud * 0.95, 1.6, haze) * smoothstep(0.05, 0.28, y);
      col = mix(col, uHorizon * (1.05 - 0.23 * uCloud), cloud * 0.62);
      if (uNight > 0.05 && y > 0.09) {
        vec2 star = vec2(atan(ray.z, ray.x) * 125.0, ray.y * 240.0);
        float starCell = hash(floor(star));
        float stars = step(0.992, starCell) * (1.0 - smoothstep(0.05, 0.22, length(fract(star) - 0.5)));
        col += vec3(0.50, 0.65, 0.83) * stars * uNight * (1.0 - uCloud) * smoothstep(0.09, 0.35, y);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const seaVert = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const seaFrag = /* glsl */`
  uniform vec3 uDeep, uShelf, uHorizon, uSun;
  uniform float uTime, uDay, uCloud, uFog;
  uniform bool uDetail;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz;
    float warp = sin(p.x * 0.013 - p.y * 0.021 + uTime * 0.08);
    float swell = sin(p.x * 0.045 + p.y * 0.074 - uTime * 0.94 + warp * 1.35);
    float chop = uDetail ? sin(-p.x * 0.107 + p.y * 0.048 - uTime * 1.23 + warp * 1.12) : 0.0;
    float ripple = uDetail ? sin(p.x * 0.31 + p.y * 0.27 + uTime * 1.8) : 0.0;
    float shoal = length((p + vec2(15.0, 27.0)) / vec2(485.0, 320.0)) + (warp + chop * 0.20) * 0.032;
    float shallow = 1.0 - smoothstep(0.89, 1.30, shoal);
    vec3 sea = mix(uDeep, uShelf, shallow * 0.88);
    vec3 toward = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    float detail = 1.0 - smoothstep(650.0, 1750.0, dist);
    float small = 1.0 - smoothstep(390.0, 1060.0, dist);
    vec3 normal = normalize(vec3((0.08 * swell - 0.055 * chop + ripple * 0.021 * small) * detail, 1.0, (0.115 * swell + 0.038 * chop) * detail));
    float facing = 1.0 - max(0.0, dot(normal, toward));
    float fresnel = facing * facing * facing * facing;
    sea += (swell * 0.004 + chop * 0.004 + ripple * 0.0028 * small) * detail * (0.24 + uDay);
    sea = mix(sea, uHorizon * 0.72, fresnel * 0.56);
    if (uDetail) {
      float spec = pow(max(0.0, dot(reflect(-uSun, normal), toward)), 68.0);
      sea += (vec3(0.63, 0.76, 0.63) * spec * (1.0 - uCloud) * uDay) * 0.72;
      float foam = smoothstep(0.84, 1.0, swell) * smoothstep(0.47, 1.0, chop) * shallow;
      sea += vec3(0.04, 0.07, 0.073) * foam * detail * uDay;
    }
    float air = 1.0 - exp(-dist * dist * uFog * uFog * 0.73);
    gl_FragColor = vec4(mix(sea, uHorizon, air), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const colors = {
  high: new T.Color(0x497f9d), low: new T.Color(0xb7cad5),
  highDark: new T.Color(0x111e39), lowDark: new T.Color(0x304b61),
  sunset: new T.Color(0xe1a179), overcast: new T.Color(0x76858f), graySky: new T.Color(0x485969),
  dayDeep: new T.Color(0x326a81), dayShelf: new T.Color(0x4c9a9d),
  darkDeep: new T.Color(0x122b44), darkShelf: new T.Color(0x214a5b),
  whiteSun: new T.Color(0xfff4dc), redSun: new T.Color(0xffb36d), duskHemi: new T.Color(0x829bbe),
  dayHemi: new T.Color(0xe3f5ff),
};

export class Environment {
  readonly group = new T.Group();
  readonly fog = new T.FogExp2(0x8ba9b5, 0.0007);
  readonly sun = new T.DirectionalLight(0xfff1d8, 2.3);
  private readonly hemisphere = new T.HemisphereLight(0xd9edf3, 0x677568, 1.6);
  private readonly zenith = new T.Color();
  private readonly horizon = new T.Color();
  private readonly direction = new T.Vector3();
  private readonly deep = new T.Color();
  private readonly shelf = new T.Color();
  private readonly sky: T.Mesh<T.SphereGeometry, T.ShaderMaterial>;
  private readonly sea: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;

  constructor(seed: number) {
    this.group.name = 'Ocean, atmosphere and exterior lighting';
    this.sky = new T.Mesh(new T.SphereGeometry(3900, 24, 12), new T.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: T.BackSide, depthWrite: false,
      uniforms: { uZenith: { value: this.zenith }, uHorizon: { value: this.horizon }, uSun: { value: this.direction },
        uNight: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 }, uTwilight: { value: 0 } },
    }));
    // Opaque geometry writes depth first, so the two large shaders only shade exposed pixels.
    this.sky.renderOrder = 100;
    this.sky.frustumCulled = false;
    this.sea = new T.Mesh(new T.PlaneGeometry(12500, 12500).rotateX(-Math.PI / 2), new T.ShaderMaterial({
      vertexShader: seaVert, fragmentShader: seaFrag,
      uniforms: { uDeep: { value: this.deep }, uShelf: { value: this.shelf }, uHorizon: { value: this.horizon }, uSun: { value: this.direction },
        uTime: { value: 0 }, uDay: { value: 1 }, uCloud: { value: 0 }, uFog: { value: 0.0007 }, uDetail: { value: true } },
    }));
    this.sea.position.y = -1.76;
    this.sea.renderOrder = 10;
    this.sun.castShadow = true;
    this.sun.target.position.set(0, 0, -15);
    const shadow = this.sun.shadow;
    Object.assign(shadow.camera, { left: -570, right: 570, top: 490, bottom: -490, near: 20, far: 2400 });
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.00026;
    shadow.normalBias = 0.5;
    shadow.radius = 2;
    this.group.add(this.sky, this.sea, this.sun, this.sun.target, this.hemisphere);

    const rng = random(seed + 119);
    const hill = new T.IcosahedronGeometry(1, 0);
    const hazeRock = new T.MeshStandardMaterial({ color: 0x7e9498, roughness: 1, flatShading: true });
    const islands = new Batch(hill, hazeRock);
    for (const [x, z, span] of [[-1030, -850, 350], [-1100, 430, 235], [600, -1010, 280], [1150, -690, 320]] as const) {
      for (let i = -2; i <= 2; i++) {
        islands.add(x + i * span * 0.38, -13, z + rng() * 78, span * (0.43 + rng() * 0.36),
          30 + rng() * 75, span * (0.32 + rng() * 0.29), undefined, rng() * 4);
      }
    }
    islands.mount(this.group, 'Distant island silhouettes', false, false);
  }

  setShadowMap(size: number): void {
    const shadow = this.sun.shadow;
    if (size && shadow.mapSize.x === size) return;
    shadow.map?.dispose();
    shadow.map = null;
    if (size) shadow.mapSize.set(size, size);
    shadow.needsUpdate = true;
  }

  setDetail(enabled: boolean): void { this.sea.material.uniforms.uDetail!.value = enabled; }

  follow(camera: T.Camera): void { this.sky.position.copy(camera.position); }

  update(minute: number, seconds: number, rain: number, snow: number, shadowUpdate: boolean): number {
    const { phase, elevation, daylight, twilight, night } = solarAt(minute);
    const cloud = Math.min(1, rain * 0.88 + snow * 0.75);
    this.direction.set(-Math.cos(phase) * 0.72 - 0.24, elevation, 0.47).normalize();
    this.zenith.copy(colors.highDark).lerp(colors.high, daylight).lerp(colors.graySky, cloud * 0.78);
    this.horizon.copy(colors.lowDark).lerp(colors.low, daylight).lerp(colors.sunset, twilight * (1 - cloud) * 0.60)
      .lerp(colors.overcast, cloud * (0.27 + daylight * 0.53));
    this.deep.copy(colors.darkDeep).lerp(colors.dayDeep, daylight * (1 - cloud * 0.40));
    this.shelf.copy(colors.darkShelf).lerp(colors.dayShelf, daylight * (1 - cloud * 0.53));
    const sky = this.sky.material.uniforms, sea = this.sea.material.uniforms;
    sky.uNight!.value = night; sky.uCloud!.value = cloud; sky.uTime!.value = seconds; sky.uTwilight!.value = twilight;
    sea.uTime!.value = seconds; sea.uDay!.value = daylight; sea.uCloud!.value = cloud;
    this.fog.color.copy(this.horizon);
    this.fog.density = 0.00037 + rain * 0.00057 + snow * 0.00096;
    sea.uFog!.value = this.fog.density;
    this.hemisphere.color.copy(colors.duskHemi).lerp(colors.dayHemi, daylight);
    this.hemisphere.intensity = mix(0.67, 1.72, daylight) * (1 - cloud * 0.14);
    this.sun.intensity = Math.max(0, elevation) * 2.7 * (1 - cloud * 0.80);
    this.sun.color.copy(colors.whiteSun).lerp(colors.redSun, twilight * 0.8);
    // Keep light pose and the cached shadow matrix in sync.
    if (shadowUpdate || !this.sun.castShadow) {
      this.sun.position.copy(this.direction).multiplyScalar(940);
      this.sun.position.y = Math.max(81, this.sun.position.y);
      this.sun.shadow.needsUpdate = true;
    }
    return night;
  }
}
