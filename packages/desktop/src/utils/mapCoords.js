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

// Approximate territorial bounding boxes (mainland only, overseas
// territories ignored) for the same ISO set -- used to highlight roughly
// "this country's" dots on the map rather than a single pin. Not precise
// borders, just close enough that the right region visibly lights up.
const COUNTRY_BBOX = {
  US: { latMin: 24.5, latMax: 49.5, lngMin: -125, lngMax: -66.9 },
  DE: { latMin: 47.3, latMax: 55.1, lngMin: 5.9, lngMax: 15.0 },
  NL: { latMin: 50.75, latMax: 53.6, lngMin: 3.3, lngMax: 7.2 },
  FR: { latMin: 41.3, latMax: 51.1, lngMin: -5.2, lngMax: 9.6 },
  GB: { latMin: 49.9, latMax: 60.9, lngMin: -8.6, lngMax: 1.8 },
  TR: { latMin: 35.8, latMax: 42.1, lngMin: 25.9, lngMax: 44.8 },
  JP: { latMin: 24.0, latMax: 45.6, lngMin: 122.9, lngMax: 153.9 },
  SG: { latMin: 1.15, latMax: 1.47, lngMin: 103.6, lngMax: 104.1 },
  HK: { latMin: 22.15, latMax: 22.56, lngMin: 113.83, lngMax: 114.44 },
  KR: { latMin: 33.0, latMax: 38.6, lngMin: 124.6, lngMax: 131.0 },
  RU: { latMin: 41.2, latMax: 81.9, lngMin: 19.6, lngMax: 180 },
  IR: { latMin: 25.0, latMax: 39.8, lngMin: 44.0, lngMax: 63.3 },
  AE: { latMin: 22.6, latMax: 26.1, lngMin: 51.5, lngMax: 56.4 },
  FI: { latMin: 59.8, latMax: 70.1, lngMin: 20.5, lngMax: 31.6 },
  SE: { latMin: 55.3, latMax: 69.1, lngMin: 11.0, lngMax: 24.2 },
  NO: { latMin: 57.9, latMax: 71.2, lngMin: 4.5, lngMax: 31.3 },
  PL: { latMin: 49.0, latMax: 54.9, lngMin: 14.1, lngMax: 24.2 },
  IT: { latMin: 36.6, latMax: 47.1, lngMin: 6.6, lngMax: 18.5 },
  ES: { latMin: 36.0, latMax: 43.8, lngMin: -9.3, lngMax: 3.3 },
  CA: { latMin: 41.7, latMax: 83.1, lngMin: -141, lngMax: -52.6 },
  AU: { latMin: -43.6, latMax: -10.7, lngMin: 113.2, lngMax: 153.6 },
  IN: { latMin: 8.1, latMax: 35.5, lngMin: 68.1, lngMax: 97.4 },
  BR: { latMin: -33.7, latMax: 5.3, lngMin: -73.9, lngMax: -34.8 },
  UA: { latMin: 44.4, latMax: 52.4, lngMin: 22.1, lngMax: 40.2 },
  CZ: { latMin: 48.6, latMax: 51.1, lngMin: 12.1, lngMax: 18.9 },
  AT: { latMin: 46.4, latMax: 49.0, lngMin: 9.5, lngMax: 17.2 },
  CH: { latMin: 45.8, latMax: 47.8, lngMin: 6.0, lngMax: 10.5 },
  BG: { latMin: 41.2, latMax: 44.2, lngMin: 22.4, lngMax: 28.6 },
  RO: { latMin: 43.6, latMax: 48.3, lngMin: 20.3, lngMax: 29.7 },
  AM: { latMin: 38.8, latMax: 41.3, lngMin: 43.4, lngMax: 46.6 },
  LT: { latMin: 53.9, latMax: 56.4, lngMin: 21.0, lngMax: 26.8 },
  LV: { latMin: 55.7, latMax: 58.1, lngMin: 21.0, lngMax: 28.2 },
  EE: { latMin: 57.5, latMax: 59.7, lngMin: 21.8, lngMax: 28.2 },
  CN: { latMin: 18.2, latMax: 53.6, lngMin: 73.5, lngMax: 135.1 },
  TW: { latMin: 21.9, latMax: 25.3, lngMin: 120.0, lngMax: 122.0 },
  MY: { latMin: 0.85, latMax: 7.4, lngMin: 99.6, lngMax: 119.3 },
  ID: { latMin: -11.0, latMax: 6.1, lngMin: 95.0, lngMax: 141.0 },
  TH: { latMin: 5.6, latMax: 20.5, lngMin: 97.3, lngMax: 105.6 },
  VN: { latMin: 8.4, latMax: 23.4, lngMin: 102.1, lngMax: 109.5 },
  ZA: { latMin: -34.8, latMax: -22.1, lngMin: 16.5, lngMax: 32.9 },
  MX: { latMin: 14.5, latMax: 32.7, lngMin: -117.1, lngMax: -86.7 },
  KZ: { latMin: 40.6, latMax: 55.4, lngMin: 46.5, lngMax: 87.3 },
  QA: { latMin: 24.5, latMax: 26.2, lngMin: 50.7, lngMax: 51.7 },
};

// Fallback pool for the disconnected-state "random location" animation, when
// no real server data drives the pick -- a spread of common proxy/VPN hub
// regions so the idle map still looks alive.
const HUB_ISOS = ['US', 'DE', 'NL', 'GB', 'JP', 'SG', 'FR', 'CA', 'AU', 'FI', 'HK', 'BR', 'IN', 'TR', 'KR'];

export function coordsFor(iso) {
  return iso ? COUNTRY_COORDS[iso] || null : null;
}

export function bboxFor(iso) {
  return iso ? COUNTRY_BBOX[iso] || null : null;
}

export function randomHub() {
  const iso = HUB_ISOS[Math.floor(Math.random() * HUB_ISOS.length)];
  return { iso, ...COUNTRY_COORDS[iso] };
}

export { COUNTRY_COORDS, COUNTRY_BBOX, HUB_ISOS };
