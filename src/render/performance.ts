import type { WebGLRenderer } from 'three';

export const QUALITY = {
  economy: { label: '流畅', dpr: 0.79, scale: 0.73, maxPixels: 510_000, shadow: 0, particles: 600, actorShare: 0.65, detail: false },
  balanced: { label: '均衡', dpr: 1.15, scale: 1, maxPixels: 1_450_000, shadow: 1280, particles: 1450, actorShare: 1, detail: true },
  detail: { label: '精细', dpr: 1.75, scale: 1.33, maxPixels: 2_600_000, shadow: 2048, particles: 2400, actorShare: 1, detail: true },
} as const;
export type Quality = keyof typeof QUALITY;

export function defaultQuality(renderer: WebGLRenderer): Quality {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const label = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  return /swiftshader|llvmpipe|software rasterizer|basic render driver|softpipe/i.test(label) ? 'economy' : 'balanced';
}

class Samples {
  private readonly buffer = new Float32Array(72);
  private used = 0;
  private head = 0;
  push(n: number): void {
    this.buffer[this.head] = n;
    this.head = (this.head + 1) % this.buffer.length;
    this.used = Math.min(this.used + 1, this.buffer.length);
  }
  get stats(): { mean: number; p95: number; n: number } {
    if (!this.used) return { mean: 0, p95: 0, n: 0 };
    const active = this.buffer.slice(0, this.used).sort();
    return { mean: active.reduce((a, b) => a + b, 0) / this.used,
      p95: active[Math.ceil(this.used * 0.95) - 1]!, n: this.used };
  }
  clear(): void { this.used = this.head = 0; }
}

interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
class GpuTimer {
  readonly gl: WebGL2RenderingContext;
  private timer: TimerExtension | null;
  private query: WebGLQuery | null = null;
  private started = false;
  private lastStart = -Infinity;
  ms: number | null = null;

  constructor(renderer: WebGLRenderer) {
    // The pinned Three.js WebGLRenderer requires WebGL 2.
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  }
  begin(now: number): void {
    const { gl, timer } = this;
    if (!timer || gl.isContextLost()) return;
    if (this.query) {
      if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) this.ms = Number(gl.getQueryParameter(this.query, gl.QUERY_RESULT)) / 1_000_000;
      else this.ms = null;
      gl.deleteQuery(this.query);
      this.query = null;
    }
    if (now < this.lastStart + 950) return;
    this.query = gl.createQuery();
    if (!this.query) return;
    this.lastStart = now;
    gl.beginQuery(timer.TIME_ELAPSED_EXT, this.query);
    this.started = true;
  }
  end(): void {
    if (!this.started || !this.timer) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.started = false;
  }
  reset(restored = false): void {
    if (this.query && !this.gl.isContextLost() && !restored) this.gl.deleteQuery(this.query);
    this.query = null; this.ms = null; this.started = false; this.lastStart = -Infinity;
    if (restored) this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  }
}

export class PerformanceMonitor {
  private readonly intervals = new Samples();
  private readonly submits = new Samples();
  private readonly gpu: GpuTimer;
  private lastDraw = 0;
  frames = 0;
  shadowDraws = 0;

  constructor(private readonly renderer: WebGLRenderer) { this.gpu = new GpuTimer(renderer); }

  begin(now: number): void { this.gpu.begin(now); }
  end(now: number, submit: number, updatedShadow: boolean): void {
    this.gpu.end();
    const interval = now - this.lastDraw;
    if (this.lastDraw && interval < 1500) this.intervals.push(interval);
    this.lastDraw = now;
    this.submits.push(submit);
    this.frames++;
    if (updatedShadow) this.shadowDraws++;
  }
  reset(restored = false): void { this.lastDraw = 0; this.intervals.clear(); this.submits.clear(); this.gpu.reset(restored); }
  snapshot(now: number) {
    const { render, memory } = this.renderer.info;
    const interval = this.intervals.stats, submit = this.submits.stats;
    const idle = now - this.lastDraw > 420;
    return {
      idle, fps: !idle && interval.mean > 0 ? 1000 / interval.mean : 0, p95FrameMs: interval.p95,
      cpuP95Ms: submit.p95, gpuMs: this.gpu.ms, samples: interval.n,
      drawCalls: render.calls, triangles: render.triangles, points: render.points,
      geometries: memory.geometries, textures: memory.textures, frames: this.frames,
      shadowDraws: this.shadowDraws, pixels: this.gpu.gl.drawingBufferWidth * this.gpu.gl.drawingBufferHeight,
    };
  }
}
export type Metrics = ReturnType<PerformanceMonitor['snapshot']>;
