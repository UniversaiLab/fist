import React, { useEffect, useMemo, useState } from 'react';
import DottedMap from 'dotted-map';
import CoreLogic from '@soul-connection/core-logic';
import { coordsFor } from '../utils/mapCoords.js';

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
// changes, only which pin is highlighted does, so there's no reason to pay
// this cost (a few hundred ms) more than once per launch.
let mapSingleton = null;
function getMap() {
  if (!mapSingleton) {
    mapSingleton = new DottedMap({ height: 56, grid: 'diagonal' });
  }
  return mapSingleton;
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
  const busy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const idle = connectionState === 'disconnected';

  // Only ever points at the actual target server's real detected location
  // (best-effort, name-based -- see core-logic/geo.js) -- no idle-state
  // random-city highlighting, so the map stays quiet until there's a real
  // location to show.
  const targetCoords = useMemo(() => {
    if (idle || !activeProfile) return null;
    const geo = countryOf(activeProfile);
    const coords = coordsFor(geo?.iso);
    return coords ? { ...coords, iso: geo.iso, label: geo.label } : null;
  }, [idle, activeProfile]);

  const pin = useMemo(
    () => (targetCoords ? map.getPin({ lat: targetCoords.lat, lng: targetCoords.lng }) : null),
    [map, targetCoords]
  );

  const statText = useStatCycle(idle);

  return (
    <div className={`map-bg ${connectionState}`} aria-hidden="true">
      <svg className="map-bg-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice">
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.32} className="map-dot" />
        ))}
        {pin && (
          <g className={`map-pin ${connected ? 'connected' : 'busy'}`}>
            <circle cx={pin.x} cy={pin.y} r={3.2} className="map-pin-wave map-pin-wave-2" />
            <circle cx={pin.x} cy={pin.y} r={2.2} className="map-pin-wave" />
            <circle cx={pin.x} cy={pin.y} r={0.75} className="map-pin-core" />
          </g>
        )}
      </svg>

      {idle && (
        <div className="map-stat-line mono">
          <span className="map-stat-dot" />
          {statText}
        </div>
      )}

      {!idle && targetCoords?.label && (
        <div className="map-loc-line mono">
          {connected ? 'CONNECTED ·' : 'ROUTING ·'} {targetCoords.label.toUpperCase()}
        </div>
      )}
    </div>
  );
}
