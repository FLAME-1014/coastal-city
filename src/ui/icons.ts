const paths = {
  pause: '<path d="M10 5H7v14h3zm7 0h-3v14h3z" fill="currentColor" stroke="none"/>',
  play: '<path d="m8 5 12 7-12 7Z" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 1.6-2.9 2-2.9 4m0 2.9h.01"/>',
  home: '<path d="M4 12 12 5l8 7m-14-1v8h12v-8m-8 8v-5h4v5"/>',
  orbit: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zm-8 4.5 8 4.5 8-4.5M12 12v9"/>',
  plan: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16m-10 0v10m5-16v6"/>',
  coast: '<path d="M4 8c2.6 0 2.8 2.5 5.4 2.5S12 8 14.6 8s2.8 2.5 5.4 2.5M4 14c2.6 0 2.8 2.5 5.4 2.5S12 14 14.6 14s2.8 2.5 5.4 2.5"/>',
  street: '<path d="m9 4-5 16m11-16 5 16m-8 0v-3m0-3v-3m0-3V4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zm6-3v15m6-12v15"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19m0-14-1.4 1.4M6.4 17.6 5 19"/>',
  rain: '<path d="M7.3 14H6a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.5-1.4A4.3 4.3 0 1 1 18 14h-4.5M9 14l-2 5m7-4-2 5m6-3-1 3"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10m0-10L3.3 17M9.5 4.5 12 7l2.5-2.5m-5 15L12 17l2.5 2.5M4.4 10.5l3.4-1-.9-3.3m10.2 11.6-.9-3.3 3.4-1m-15.2 0 3.4 1-.9 3.3m10.2-11.6-.9 3.3 3.4 1"/>',
  auto: '<path d="M20 8a8.5 8.5 0 0 0-14.5-2L3 9m18-5v5h-5M4 16a8.5 8.5 0 0 0 14.5 2l2.5-3M3 20v-5h5"/>',
  event: '<path d="M12 22V8m0 0 5-5 5 5-5 5zm0 6-4-4-5 5 5 5"/>',
  target: '<path d="M6 3H3v3m15-3h3v3M3 18v3h3m12 0h3v-3"/><circle cx="12" cy="12" r="4"/>',
  chart: '<path d="M3 18h18M6 14v-3m4 3V8m4 6V5m4 9V9"/>',
} as const;

export type Icon = keyof typeof paths;
export const icon = (name: Icon, size = 18): string => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
export const mark = `<svg viewBox="0 0 46 46" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 27V18l8-5v12m0-7 7-4V7l8 6v11m0-4 7-4v12M7 31c5-5 10 5 16 0s10-4 16 0M7 37c5-5 10 5 16 0s10-4 16 0"/></svg>`;
