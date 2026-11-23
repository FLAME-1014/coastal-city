import { describe, expect, it } from 'vitest';
import { Simulation, clockText, conditions, mobility, solarAt } from '../src/city/simulation';

describe('simulation', () => {
  it('rolls midnight forward and preserves the current day when seeking', () => {
    const sim = new Simulation();
    sim.seek(1439); sim.setRate(24); sim.step(0.1);
    expect(sim.day).toBe(2);
    expect(sim.minute).toBeCloseTo(1.4);
    sim.seek(732);
    expect(sim.day).toBe(2);
    expect(clockText(sim.minute)).toBe('12:12');
  });

  it('freezes clock and motion on pause and clamps an oversize frame after resuming', () => {
    const sim = new Simulation();
    sim.setRate(60); sim.setPlaying(false);
    const now = sim.minute;
    expect(sim.step(50)).toBe(0);
    expect(sim.minute).toBe(now);
    expect(sim.activeSeconds).toBe(0);
    sim.setPlaying(true);
    expect(sim.step(50)).toBeCloseTo(0.32);
    expect(sim.minute).toBe(now + 6);
    expect(sim.step(-10)).toBe(0);
    expect(sim.step(NaN)).toBe(0);
    sim.setRate(999); sim.seek(NaN);
    expect(sim.rate).toBe(60);
    expect(sim.minute).toBe(now + 6);
  });

  it('derives scheduled weather, allows overrides and updates modeled visibility and PV', () => {
    const sim = new Simulation();
    for (const [minute, weather] of [[629, 'clear'], [630, 'rain'], [810, 'clear'], [1140, 'snow'], [1350, 'clear']] as const) {
      sim.seek(minute); expect(sim.weather).toBe(weather);
    }
    sim.setWeather('snow'); sim.seek(720); expect(sim.weather).toBe('snow');
    expect(conditions(720, 'snow').visibilityKm).toBeLessThan(conditions(720, 'clear').visibilityKm);
    expect(conditions(720, 'rain').solarFraction).toBeLessThan(conditions(720, 'clear').solarFraction);
    expect(conditions(30, 'clear').solarFraction).toBe(0);
    sim.setWeather('auto'); expect(sim.weather).toBe('rain');
    expect(solarAt(720).daylight).toBe(1);
    expect(solarAt(0).night).toBe(1);
  });

  it('changes district traffic and footfall during scheduled events only', () => {
    const sim = new Simulation();
    sim.seek(420); expect(sim.activeEvent?.id).toBe('commute');
    sim.seek(570); expect(sim.activeEvent).toBeUndefined();
    expect(sim.nextEvent.id).toBe('dock');
    expect(mobility('bay', 550, 'clear').vehicleShare).toBeGreaterThan(mobility('bay', 590, 'clear').vehicleShare);
    expect(mobility('harbor', 720, 'clear').vehicleSpeed).toBeLessThan(mobility('bay', 720, 'clear').vehicleSpeed);
    expect(mobility('green', 1020, 'clear').walkingShare).toBeGreaterThan(mobility('bay', 1020, 'clear').walkingShare);
    expect(mobility('green', 1020, 'rain').walkingShare).toBeLessThan(mobility('green', 1020, 'clear').walkingShare);
  });
});
