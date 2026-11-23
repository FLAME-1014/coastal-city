import { clamp, smooth, wrap } from './geometry';
import type { DistrictId } from './layout';

export const DAY_MINUTES = 1440;
export const SPEEDS = [1, 6, 24, 60] as const;
export type Speed = typeof SPEEDS[number];
export type Weather = 'clear' | 'rain' | 'snow';
export type WeatherMode = Weather | 'auto';
export const WEATHER_NAMES: Record<Weather, string> = { clear: '晴朗', rain: '降雨', snow: '降雪' };
export const EVENTS = [
  { id: 'commute', district: 'bay', title: '早高峰通勤', start: 7 * 60, end: 9 * 60 + 30, kind: 'transport',
    text: '中央湾增派通勤车辆，主干道降低车速。' },
  { id: 'dock', district: 'harbor', title: '码头例行检修', start: 11 * 60 + 30, end: 13 * 60, kind: 'maintenance',
    text: '东岬港减发车辆，港区通行速度下降。' },
  { id: 'market', district: 'green', title: '滨海市集', start: 16 * 60 + 30, end: 20 * 60 + 30, kind: 'community',
    text: '湿地海岸步道增加行人，沿岸道路减速。' },
] as const;
export type CityEvent = typeof EVENTS[number];
export const WEATHER_SCHEDULE = [
  { start: 0, weather: 'clear' }, { start: 10 * 60 + 30, weather: 'rain' },
  { start: 13 * 60 + 30, weather: 'clear' }, { start: 19 * 60, weather: 'snow' },
  { start: 22 * 60 + 30, weather: 'clear' },
] as const;

export function clockText(minute: number): string {
  const m = Math.floor(wrap(minute, DAY_MINUTES));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function weatherAt(minute: number): Weather {
  for (let i = WEATHER_SCHEDULE.length - 1; i >= 0; i--) {
    const stage = WEATHER_SCHEDULE[i]!;
    if (minute >= stage.start) return stage.weather;
  }
  return 'clear';
}

export function solarAt(minute: number) {
  const phase = (minute - 360) * Math.PI / 720;
  const elevation = Math.sin(phase);
  const daylight = smooth(-0.17, 0.35, elevation);
  const twilight = (1 - smooth(0.03, 0.38, Math.abs(elevation))) * smooth(-0.23, -0.05, elevation);
  return { phase, elevation, daylight, twilight, night: 1 - smooth(-0.22, 0.12, elevation) };
}

export function conditions(minute: number, weather: Weather) {
  const { daylight, elevation } = solarAt(minute);
  return {
    temperature: Math.round((weather === 'snow' ? -3 : weather === 'rain' ? 14 : 18) + daylight * 5),
    visibilityKm: weather === 'snow' ? 2.6 : weather === 'rain' ? 4.2 : 12,
    windKmh: weather === 'snow' ? 24 : weather === 'rain' ? 31 : Math.round(10 + 5 * daylight),
    solarFraction: Math.max(0, elevation) * (weather === 'clear' ? 1 : weather === 'rain' ? 0.32 : 0.22),
  };
}

export interface Mobility { vehicleSpeed: number; vehicleShare: number; walkingSpeed: number; walkingShare: number }
export function mobility(district: DistrictId, minute: number, weather: Weather, out?: Mobility): Mobility {
  const day = solarAt(minute).daylight;
  const commute = district === 'bay' && minute >= EVENTS[0].start && minute < EVENTS[0].end;
  const dock = district === 'harbor' && minute >= EVENTS[1].start && minute < EVENTS[1].end;
  const market = district === 'green' && minute >= EVENTS[2].start && minute < EVENTS[2].end;
  const state = out ?? { vehicleSpeed: 1, vehicleShare: 1, walkingSpeed: 1, walkingShare: 1 };
  state.vehicleSpeed = (weather === 'rain' ? 0.71 : weather === 'snow' ? 0.54 : 1) * (commute ? 0.76 : dock ? 0.55 : market ? 0.8 : 1);
  state.vehicleShare = dock ? 0.29 : commute ? 1 : 0.49 + day * 0.26;
  state.walkingSpeed = weather === 'snow' ? 0.69 : weather === 'rain' ? 1.16 : 1;
  state.walkingShare = (market ? 1 : 0.24 + day * 0.45) * (weather === 'rain' ? 0.57 : weather === 'snow' ? 0.49 : 1);
  return state;
}

export class Simulation {
  private totalMinutes = 9 * 60 + 12;
  private _rate: Speed = 1;
  private _playing = true;
  private _mode: WeatherMode = 'auto';
  activeSeconds = 0;

  get minute(): number { return wrap(this.totalMinutes, DAY_MINUTES); }
  get day(): number { return Math.floor(this.totalMinutes / DAY_MINUTES) + 1; }
  get rate(): Speed { return this._rate; }
  get playing(): boolean { return this._playing; }
  get mode(): WeatherMode { return this._mode; }
  get weather(): Weather { return this._mode === 'auto' ? weatherAt(this.minute) : this._mode; }
  get activeEvent(): CityEvent | undefined { return EVENTS.find(e => e.start <= this.minute && this.minute < e.end); }
  get nextEvent(): CityEvent { return EVENTS.find(e => e.start > this.minute) ?? EVENTS[0]; }

  seek(minute: number): void {
    if (Number.isFinite(minute)) this.totalMinutes = (this.day - 1) * DAY_MINUTES + clamp(minute, 0, DAY_MINUTES - 1);
  }
  setRate(rate: number): void { if (SPEEDS.some(n => n === rate)) this._rate = rate as Speed; }
  setPlaying(playing: boolean): void { this._playing = playing; }
  setWeather(mode: WeatherMode): void { this._mode = mode; }

  /** Returns motion seconds. City time can run very fast without making actors teleport. */
  step(realDelta: number): number {
    if (!this._playing || !Number.isFinite(realDelta)) return 0;
    const dt = clamp(realDelta, 0, 0.1);
    this.totalMinutes += dt * this._rate;
    const motion = dt * Math.min(3.2, Math.sqrt(this._rate));
    this.activeSeconds += motion;
    return motion;
  }
}
