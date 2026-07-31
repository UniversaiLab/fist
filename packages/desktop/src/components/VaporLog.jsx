import React, { useEffect, useRef, useState } from 'react';

const MAX_LINES = 6;
const LINE_LIFETIME_MS = 6500;

// Ambient "real-time log" for the connect screen: real proxy-engine log
// lines (same feed NetworkSettings' log panel uses), styled to drift and
// blur upward like rising vapor instead of a hard console block -- present
// enough to prove the tunnel is alive, deliberately too soft/transient to
// read as data-dense next to the map.
export default function VaporLog({ active }) {
  const [lines, setLines] = useState([]);
  const nextKey = useRef(0);

  useEffect(() => {
    if (!active || !window.soul?.onProxyLog) return undefined;

    function addLine(entry) {
      const key = nextKey.current++;
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), { ...entry, key }]);
      setTimeout(() => {
        setLines((prev) => prev.filter((l) => l.key !== key));
      }, LINE_LIFETIME_MS);
    }

    // Seed with whatever already logged before this mounted -- otherwise the
    // vapor is empty until the next line happens to arrive live.
    window.soul.getRecentProxyLogs?.().then((recent) => {
      (recent || []).slice(-3).forEach(addLine);
    }).catch(() => {});

    return window.soul.onProxyLog(addLine);
  }, [active]);

  if (!active || !lines.length) return null;

  return (
    <div className="vapor-log" aria-hidden="true">
      {lines.map((l) => (
        <div key={l.key} className="vapor-line mono">
          <span className="vapor-t">{new Date(l.t).toLocaleTimeString('en-US', { hour12: false })}</span>
          <span className="vapor-msg">{l.text}</span>
        </div>
      ))}
    </div>
  );
}
