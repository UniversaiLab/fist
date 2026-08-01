import React, { useEffect, useMemo, useState } from 'react';
import DottedMap from 'dotted-map';
import CoreLogic from '@soul-connection/core-logic';
import { coordsFor, bboxFor } from '../utils/mapCoords.js';

const { countryOf } = CoreLogic;

const IDLE_STATS = [
  () => `${(8400 + Math.floor(Math.random() * 6000)).toLocaleString()} NODES ONLINE`,
  () => `${(120 + Math.floor(Math.random() * 900))} CONN/SEC`,
  () => 'NEW SERVER · FRANKFURT-DE-4',
  () => `${(1200 + Math.floor(Math.random() * 8800)).toLocaleString()} ACTIVE SESSIONS`,
  () => 'ROUTE TABLE SYNCED',
  () => `LATENCY AVG ${(28 + Math.floor(Math.random() * 60))}MS`,
  () => 'NEW SERVER · SINGAPORE-SG-2',
  () => `${(40 + Math.floor(Math.random() * 260))}TB RELAYED TODAY`,
];

// Computed once for the app's whole lifetime -- the world dot grid never
// changes, only which dots are highlighted does, so there's no reason to pay
// this cost (a few hundred ms) more than once per launch.
let mapSingleton = null;
function getMap() {
  if (!mapSingleton) {
    mapSingleton = new DottedMap({ height: 56, grid: 'diagonal' });
  }
  return mapSingleton;
}

// Which of the world map's own dots fall within a country's (approximate)
// bounding box, so we can color in the actual region instead of dropping a
// single marker on it. map.getPin({lat,lng}) snaps to the exact same grid
// cell math the background dots were generated with, so sampling the bbox
// and matching the resulting {x,y} keys against the real dot set lands
// exactly on existing dots -- no separate polygon/geo data needed, and
// off-land samples (ocean, etc.) simply match nothing and are ignored.
// Memoized per ISO since it never changes for a given map instance.
const highlightCache = new Map();
function highlightedKeysForCountry(map, iso) {
  if (highlightCache.has(iso)) return highlightCache.get(iso);
  const bbox = bboxFor(iso);
  const keys = new Set();
  if (bbox) {
    const latSpan = bbox.latMax - bbox.latMin;
    const lngSpan = bbox.lngMax - bbox.lngMin;
    const step = Math.max(0.5, Math.max(latSpan, lngSpan) / 40);
    for (let lat = bbox.latMin; lat <= bbox.latMax; lat += step) {
      for (let lng = bbox.lngMin; lng <= bbox.lngMax; lng += step) {
        const pin = map.getPin({ lat, lng });
        if (pin) keys.add(`${pin.x},${pin.y}`);
      }
    }
  }
  highlightCache.set(iso, keys);
  return keys;
}

function useStatCycle(active) {
  const [text, setText] = useState(() => IDLE_STATS[0]());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setText(IDLE_STATS[Math.floor(Math.random() * IDLE_STATS.length)]());
    }, 2600);
    return () => clearInterval(id);
  }, [active]);
  return text;
}

export default function MapBackground({ connectionState, activeProfile }) {
  const map = useMemo(() => getMap(), []);
  const points = useMemo(() => map.getPoints(), [map]);
  const { width, height } = map.image;

  const connected = connectionState === 'connected';
  const idle = connectionState === 'disconnected';

  // Only ever points at the actual target server's real detected location
  // (best-effort, name-based -- see core-logic/geo.js) -- no idle-state
  // random-city highlighting, so the map stays quiet until there's a real
  // location to show.
  const targetCountry = useMemo(() => {
    if (idle || !activeProfile) return null;
    const geo = countryOf(activeProfile);
    if (!geo || !coordsFor(geo.iso)) return null;
    return geo;
  }, [idle, activeProfile]);

  const highlightKeys = useMemo(
    () => (targetCountry ? highlightedKeysForCountry(map, targetCountry.iso) : null),
    [map, targetCountry]
  );

  const statText = useStatCycle(idle);

  return (
    <div className={`map-bg ${connectionState}`} aria-hidden="true">
      <svg className="map-bg-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice">
        {points.map((p, i) => {
          const lit = highlightKeys?.has(`${p.x},${p.y}`);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={lit ? 0.4 : 0.32}
              className={`map-dot ${lit ? `highlight ${connected ? 'connected' : 'busy'}` : ''}`}
            />
          );
        })}
      </svg>

      {idle && (
        <div className="map-stat-line mono">
          <span className="map-stat-dot" />
          {statText}
        </div>
      )}

      {!idle && targetCountry?.label && (
        <div className="map-loc-line mono">
          {connected ? 'CONNECTED ·' : 'ROUTING ·'} {targetCountry.label.toUpperCase()}
        </div>
      )}
    </div>
  );
}
