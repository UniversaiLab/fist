// Approximate capital/major-city coordinates for the same ISO set as
// core-logic's geo.js, used only to place a pin on the connect screen's dotted
// world map -- not precise geolocation, just enough to point at the right
// region of the globe for a given server's detected country.
const COUNTRY_COORDS = {
  US: { lat: 38.9, lng: -77.0 },
  DE: { lat: 50.1, lng: 8.7 },
  NL: { lat: 52.4, lng: 4.9 },
  FR: { lat: 48.9, lng: 2.4 },
  GB: { lat: 51.5, lng: -0.1 },
  TR: { lat: 41.0, lng: 28.9 },
  JP: { lat: 35.7, lng: 139.7 },
  SG: { lat: 1.35, lng: 103.8 },
  HK: { lat: 22.3, lng: 114.2 },
  KR: { lat: 37.6, lng: 127.0 },
  RU: { lat: 55.8, lng: 37.6 },
  IR: { lat: 35.7, lng: 51.4 },
  AE: { lat: 25.2, lng: 55.3 },
  FI: { lat: 60.2, lng: 24.9 },
  SE: { lat: 59.3, lng: 18.1 },
  NO: { lat: 59.9, lng: 10.7 },
  PL: { lat: 52.2, lng: 21.0 },
  IT: { lat: 41.9, lng: 12.5 },
  ES: { lat: 40.4, lng: -3.7 },
  CA: { lat: 43.7, lng: -79.4 },
  AU: { lat: -33.9, lng: 151.2 },
  IN: { lat: 19.1, lng: 72.9 },
  BR: { lat: -23.5, lng: -46.6 },
  UA: { lat: 50.5, lng: 30.5 },
  CZ: { lat: 50.1, lng: 14.4 },
  AT: { lat: 48.2, lng: 16.4 },
  CH: { lat: 47.4, lng: 8.5 },
  BG: { lat: 42.7, lng: 23.3 },
  RO: { lat: 44.4, lng: 26.1 },
  AM: { lat: 40.2, lng: 44.5 },
  LT: { lat: 54.7, lng: 25.3 },
  LV: { lat: 56.9, lng: 24.1 },
  EE: { lat: 59.4, lng: 24.8 },
  CN: { lat: 31.2, lng: 121.5 },
  TW: { lat: 25.0, lng: 121.6 },
  MY: { lat: 3.1, lng: 101.7 },
  ID: { lat: -6.2, lng: 106.8 },
  TH: { lat: 13.8, lng: 100.5 },
  VN: { lat: 21.0, lng: 105.8 },
  ZA: { lat: -26.2, lng: 28.0 },
  MX: { lat: 19.4, lng: -99.1 },
  KZ: { lat: 43.2, lng: 76.9 },
  QA: { lat: 25.3, lng: 51.5 },
};

// Fallback pool for the disconnected-state "random location" animation, when
// no real server data drives the pick -- a spread of common proxy/VPN hub
// regions so the idle map still looks alive.
const HUB_ISOS = ['US', 'DE', 'NL', 'GB', 'JP', 'SG', 'FR', 'CA', 'AU', 'FI', 'HK', 'BR', 'IN', 'TR', 'KR'];

export function coordsFor(iso) {
  return iso ? COUNTRY_COORDS[iso] || null : null;
}

export function randomHub() {
  const iso = HUB_ISOS[Math.floor(Math.random() * HUB_ISOS.length)];
  return { iso, ...COUNTRY_COORDS[iso] };
}

export { COUNTRY_COORDS, HUB_ISOS };
