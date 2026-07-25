// Best-effort country detection from a profile's name/remark. Config names in
// the wild carry flag emoji, ISO codes ("DE-2", "[US]") or city names; there is
// no GeoIP here on purpose — no network lookups, works fully offline.

const COUNTRIES = {
  US: { label: 'United States', keys: ['usa', 'united states', 'america', 'new york', 'dallas', 'los angeles', 'seattle', 'chicago', 'ashburn', 'miami', 'san jose', 'virginia', 'oregon'] },
  DE: { label: 'Germany', keys: ['germany', 'german', 'frankfurt', 'falkenstein', 'nuremberg', 'nurnberg', 'berlin', 'dusseldorf'] },
  NL: { label: 'Netherlands', keys: ['netherlands', 'holland', 'amsterdam', 'naaldwijk'] },
  FR: { label: 'France', keys: ['france', 'paris', 'marseille', 'gravelines', 'roubaix'] },
  GB: { label: 'United Kingdom', keys: ['united kingdom', 'britain', 'england', 'london', 'manchester'] },
  TR: { label: 'Turkey', keys: ['turkey', 'turkiye', 'istanbul', 'izmir', 'ankara', 'bursa'] },
  JP: { label: 'Japan', keys: ['japan', 'tokyo', 'osaka'] },
  SG: { label: 'Singapore', keys: ['singapore'] },
  HK: { label: 'Hong Kong', keys: ['hong kong', 'hongkong'] },
  KR: { label: 'South Korea', keys: ['korea', 'seoul'] },
  RU: { label: 'Russia', keys: ['russia', 'moscow', 'petersburg'] },
  IR: { label: 'Iran', keys: ['iran', 'tehran'] },
  AE: { label: 'United Arab Emirates', keys: ['emirates', 'dubai'] },
  FI: { label: 'Finland', keys: ['finland', 'helsinki'] },
  SE: { label: 'Sweden', keys: ['sweden', 'stockholm'] },
  NO: { label: 'Norway', keys: ['norway', 'oslo'] },
  PL: { label: 'Poland', keys: ['poland', 'warsaw'] },
  IT: { label: 'Italy', keys: ['italy', 'milan', 'rome'] },
  ES: { label: 'Spain', keys: ['spain', 'madrid', 'barcelona'] },
  CA: { label: 'Canada', keys: ['canada', 'toronto', 'montreal', 'vancouver', 'beauharnois'] },
  AU: { label: 'Australia', keys: ['australia', 'sydney'] },
  IN: { label: 'India', keys: ['india', 'mumbai', 'delhi', 'bangalore'] },
  BR: { label: 'Brazil', keys: ['brazil', 'sao paulo'] },
  UA: { label: 'Ukraine', keys: ['ukraine', 'kyiv', 'kiev'] },
  CZ: { label: 'Czechia', keys: ['czech', 'prague'] },
  AT: { label: 'Austria', keys: ['austria', 'vienna'] },
  CH: { label: 'Switzerland', keys: ['switzerland', 'zurich'] },
  BG: { label: 'Bulgaria', keys: ['bulgaria', 'sofia'] },
  RO: { label: 'Romania', keys: ['romania', 'bucharest'] },
  AM: { label: 'Armenia', keys: ['armenia', 'yerevan'] },
  LT: { label: 'Lithuania', keys: ['lithuania', 'vilnius'] },
  LV: { label: 'Latvia', keys: ['latvia', 'riga'] },
  EE: { label: 'Estonia', keys: ['estonia', 'tallinn'] },
  CN: { label: 'China', keys: ['china', 'shanghai', 'shenzhen'] },
  TW: { label: 'Taiwan', keys: ['taiwan', 'taipei'] },
  MY: { label: 'Malaysia', keys: ['malaysia', 'kuala lumpur'] },
  ID: { label: 'Indonesia', keys: ['indonesia', 'jakarta'] },
  TH: { label: 'Thailand', keys: ['thailand', 'bangkok'] },
  VN: { label: 'Vietnam', keys: ['vietnam', 'hanoi'] },
  ZA: { label: 'South Africa', keys: ['south africa', 'johannesburg'] },
  MX: { label: 'Mexico', keys: ['mexico'] },
  KZ: { label: 'Kazakhstan', keys: ['kazakhstan', 'almaty'] },
  QA: { label: 'Qatar', keys: ['qatar', 'doha'] },
};

function isoToFlag(iso) {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const FLAG_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

function detectCountry(name) {
  if (!name) return null;

  // 1. A flag emoji in the name is authoritative.
  const flagMatch = name.match(FLAG_RE);
  if (flagMatch) {
    const iso = [...flagMatch[0]].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65)).join('');
    const known = COUNTRIES[iso];
    return { iso, flag: flagMatch[0], label: known ? known.label : iso };
  }

  const lower = name.toLowerCase();

  // 2. City / country keywords.
  for (const [iso, c] of Object.entries(COUNTRIES)) {
    if (c.keys.some((k) => lower.includes(k))) {
      return { iso, flag: isoToFlag(iso), label: c.label };
    }
  }

  // 3. Standalone uppercase ISO tokens: "DE-01", "[US]", "SG 2".
  const tokenMatch = name.match(/(?:^|[\s\-_[\](|·])([A-Z]{2})(?=$|[\s\-_[\]()|·\d])/);
  if (tokenMatch && COUNTRIES[tokenMatch[1]]) {
    const iso = tokenMatch[1];
    return { iso, flag: isoToFlag(iso), label: COUNTRIES[iso].label };
  }

  return null;
}

const cache = new Map();

// Memoized per profile: names are stable, and the finder calls this in hot
// filter/sort paths for every keystroke.
function countryOf(profile) {
  if (!profile) return null;
  const key = profile.id + ' ' + (profile.name || '');
  if (!cache.has(key)) cache.set(key, detectCountry(profile.name || ''));
  return cache.get(key);
}

module.exports = { detectCountry, countryOf };
