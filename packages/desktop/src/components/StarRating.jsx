import React, { useState } from 'react';
import Icon from './Icon.jsx';

// Two modes from one component: a static read-out of a provider's average
// (`readOnly`), and an interactive 1-5 picker used after a purchase.
export default function StarRating({ value = 0, count, size = 12, readOnly = true, onRate }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <span className={`stars ${readOnly ? 'ro' : 'interactive'}`} title={readOnly ? `${value.toFixed(1)} out of 5` : 'Rate this config'}>
      {[1, 2, 3, 4, 5].map((n) => (
        readOnly ? (
          <span key={n} className={`star ${n <= Math.round(shown) ? 'on' : ''}`}>
            <Icon name="star" size={size} />
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`star ${n <= shown ? 'on' : ''}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onRate?.(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          >
            <Icon name="star" size={size} />
          </button>
        )
      ))}
      {readOnly && (
        <span className="stars-meta mono">
          {count ? `${value.toFixed(1)} (${count})` : 'unrated'}
        </span>
      )}
    </span>
  );
}
