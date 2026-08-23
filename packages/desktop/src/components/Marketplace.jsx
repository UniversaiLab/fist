import React, { useCallback, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import StarRating from './StarRating.jsx';
import { MOCK_LISTINGS, MOCK_MY_LISTINGS, PROTOCOL_LABELS } from '../marketplace/mockListings.js';

const OWNED_KEY = 'fist.marketplace.owned';
const MY_LISTINGS_KEY = 'fist.marketplace.myListings';
const RATINGS_KEY = 'fist.marketplace.myRatings';

// Ratings the user has given, keyed by listing id. Persisted locally so the
// UI can show "your rating" on return; the authoritative aggregate lives on
// the marketplace server (POST /api/ratings) once this tab is wired to it.
function loadMyRatings() {
  try {
    const raw = localStorage.getItem(RATINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMyRatings(map) {
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable -- the rating just won't persist across restarts
  }
}

function loadOwned() {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveOwned(set) {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // storage unavailable -- ownership just won't persist across restarts
  }
}

function loadMyListings() {
  try {
    const raw = localStorage.getItem(MY_LISTINGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMyListings(list) {
  try {
    localStorage.setItem(MY_LISTINGS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable -- published listings just won't persist
  }
}

function Stars({ rating }) {
  const full = Math.round(rating);
  return (
    <span className="mkt-stars" title={`${rating.toFixed(1)} / 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Icon key={i} name="star" size={11} className={i < full ? 'mkt-star-on' : 'mkt-star-off'} />
      ))}
    </span>
  );
}

function ListingCard({ listing, owned, buying, onBuy, myRating, onRate }) {
  return (
    <div className="mkt-card">
      <div className="mkt-card-top">
        <span className="proto-tag">{PROTOCOL_LABELS[listing.protocol] || listing.protocol}</span>
        <span className="mkt-region">{listing.flag} {listing.region}</span>
      </div>
      <div className="mkt-title">{listing.title}</div>
      <div className="mkt-creator">by {listing.creator}</div>
      <p className="mkt-desc">{listing.description}</p>
      <div className="mkt-card-bottom">
        <div className="mkt-meta">
          <Stars rating={listing.rating} />
          <span className="mkt-sales">{listing.sales} sold</span>
        </div>
        <div className="mkt-price">${listing.price.toFixed(2)}<span className="mkt-price-period">/mo</span></div>
      </div>
      <button
        className={`btn ${owned ? '' : 'primary'} mkt-buy-btn`}
        disabled={owned || buying}
        onClick={() => onBuy(listing)}
      >
        {owned ? (
          <><Icon name="check" size={13} /> Added to your servers</>
        ) : buying ? (
          'Processing…'
        ) : (
          <>Buy for ${listing.price.toFixed(2)}</>
        )}
      </button>

      {/* Rating is gated on ownership -- you can only score a provider whose
          config you actually bought, which is the same rule the server
          enforces on POST /api/ratings. */}
      {owned && (
        <div className="mkt-rate-row">
          <span className="mkt-rate-label">
            {myRating ? 'Your rating' : 'Rate this provider'}
          </span>
          <StarRating
            value={myRating || 0}
            readOnly={false}
            size={13}
            onRate={(stars) => onRate(listing, stars)}
          />
        </div>
      )}
    </div>
  );
}

function PublishForm({ onPublish, onCancel }) {
  const [title, setTitle] = useState('');
  const [protocol, setProtocol] = useState('vless');
  const [region, setRegion] = useState('');
  const [price, setPrice] = useState('2.99');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');

  const canSubmit = title.trim() && region.trim() && link.trim() && Number(price) > 0;

  return (
    <div className="mkt-publish-form">
      <label className="mkt-field">
        <span>Listing title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chicago — Low Latency VLESS" />
      </label>
      <div className="mkt-field-row">
        <label className="mkt-field">
          <span>Protocol</span>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
            {Object.entries(PROTOCOL_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="mkt-field">
          <span>Region</span>
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. United States" />
        </label>
        <label className="mkt-field mkt-field-price">
          <span>Price / mo (USD)</span>
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <label className="mkt-field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What makes this node worth buying?" />
      </label>
      <label className="mkt-field">
        <span>Config link (what buyers receive)</span>
        <input className="mono" value={link} onChange={(e) => setLink(e.target.value)} placeholder="vless://... / trojan://... / ss://... / hysteria2://..." />
      </label>
      <div className="row mkt-publish-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn primary"
          disabled={!canSubmit}
          onClick={() => onPublish({ title, protocol, region, price: Number(price), description, link })}
        >
          Publish listing
        </button>
      </div>
    </div>
  );
}

export default function Marketplace({ onBuy, onToast }) {
  const [subTab, setSubTab] = useState('browse');
  const [owned, setOwned] = useState(loadOwned);
  const [buyingId, setBuyingId] = useState(null);
  const [myListings, setMyListings] = useState(() => [...MOCK_MY_LISTINGS, ...loadMyListings()]);
  const [showPublish, setShowPublish] = useState(false);
  const [myRatings, setMyRatings] = useState(loadMyRatings);

  const handleRate = useCallback((listing, stars) => {
    setMyRatings((prev) => {
      const next = { ...prev, [listing.id]: stars };
      saveMyRatings(next);
      return next;
    });
    onToast?.(`Rated ${listing.title} ${stars}/5`);
  }, [onToast]);

  const handleBuy = useCallback(async (listing) => {
    if (owned.has(listing.id) || buyingId) return;
    setBuyingId(listing.id);
    try {
      // Simulated checkout -- no real charge, just a believable pause before
      // the config actually lands in the user's server list.
      await new Promise((resolve) => setTimeout(resolve, 550));
      await onBuy(listing);
      setOwned((prev) => {
        const next = new Set(prev);
        next.add(listing.id);
        saveOwned(next);
        return next;
      });
    } catch (err) {
      onToast?.(err.message || 'Purchase failed', 'error');
    } finally {
      setBuyingId(null);
    }
  }, [owned, buyingId, onBuy, onToast]);

  const handlePublish = useCallback((fields) => {
    const listing = {
      id: `mine-${Date.now()}`,
      title: fields.title,
      protocol: fields.protocol,
      region: fields.region,
      flag: '🏳️',
      price: fields.price,
      sales: 0,
      earnings: 0,
      status: 'live',
    };
    setMyListings((prev) => {
      const next = [listing, ...prev];
      saveMyListings(next.filter((l) => !MOCK_MY_LISTINGS.some((m) => m.id === l.id)));
      return next;
    });
    setShowPublish(false);
    onToast?.('Listing published (preview only — not visible to other users yet)');
  }, [onToast]);

  const totalEarnings = useMemo(
    () => myListings.reduce((sum, l) => sum + (l.earnings || 0), 0),
    [myListings],
  );
  const totalSales = useMemo(
    () => myListings.reduce((sum, l) => sum + (l.sales || 0), 0),
    [myListings],
  );

  return (
    <div className="marketplace">
      <div className="mkt-banner">
        <Icon name="info" size={14} />
        Preview — purchases are simulated and creator payouts aren't real money yet.
      </div>

      <div className="tabs mkt-tabs">
        <button className={`tab ${subTab === 'browse' ? 'active' : ''}`} onClick={() => setSubTab('browse')}>
          Browse
        </button>
        <button className={`tab ${subTab === 'sell' ? 'active' : ''}`} onClick={() => setSubTab('sell')}>
          Sell
        </button>
      </div>

      {subTab === 'browse' ? (
        <div className="mkt-grid">
          {MOCK_LISTINGS.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              owned={owned.has(listing.id)}
              buying={buyingId === listing.id}
              onBuy={handleBuy}
              myRating={myRatings[listing.id]}
              onRate={handleRate}
            />
          ))}
        </div>
      ) : (
        <div className="mkt-sell">
          <div className="mkt-sell-stats">
            <div className="mkt-stat">
              <span className="mkt-stat-label">Listings</span>
              <span className="mkt-stat-value">{myListings.length}</span>
            </div>
            <div className="mkt-stat">
              <span className="mkt-stat-label">Total sales</span>
              <span className="mkt-stat-value">{totalSales}</span>
            </div>
            <div className="mkt-stat">
              <span className="mkt-stat-label">Earnings</span>
              <span className="mkt-stat-value mkt-stat-earnings">${totalEarnings.toFixed(2)}</span>
            </div>
          </div>

          {showPublish ? (
            <PublishForm onPublish={handlePublish} onCancel={() => setShowPublish(false)} />
          ) : (
            <button className="btn primary mkt-publish-cta" onClick={() => setShowPublish(true)}>
              <Icon name="upload" size={14} /> Publish a new listing
            </button>
          )}

          <div className="mkt-my-listings">
            {myListings.map((listing) => (
              <div key={listing.id} className="mkt-my-row">
                <span className="proto-tag">{PROTOCOL_LABELS[listing.protocol] || listing.protocol}</span>
                <div className="mkt-my-info">
                  <div className="mkt-my-title">{listing.flag} {listing.title}</div>
                  <div className="mkt-my-sub">${listing.price.toFixed(2)}/mo · {listing.sales} sold</div>
                </div>
                <div className="mkt-my-earnings">${(listing.earnings || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
