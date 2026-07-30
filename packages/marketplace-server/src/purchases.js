'use strict';

const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Flat platform commission. In a real system this would vary by plan/tier;
// here it's just illustrative.
const PLATFORM_FEE_RATE = 0.2;

// Auth required: buy a listing. Payment is entirely simulated -- no card is
// charged, no external processor is called. The point is to exercise the
// rest of the marketplace mechanics (ledger, config delivery) end to end.
router.post('/', requireAuth, (req, res) => {
  const { listingId } = req.body || {};
  const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND status = \'live\'').get(listingId);
  if (!listing) {
    return res.status(404).json({ error: 'listing not found or no longer available' });
  }
  if (listing.creator_id === req.user.id) {
    return res.status(400).json({ error: 'you cannot buy your own listing' });
  }

  const platformFeeCents = Math.round(listing.price_cents * PLATFORM_FEE_RATE);
  const creatorEarningCents = listing.price_cents - platformFeeCents;

  const info = db.prepare(`
    INSERT INTO purchases (listing_id, buyer_id, price_cents, platform_fee_cents, creator_earning_cents, payment_status, payment_provider)
    VALUES (?, ?, ?, ?, ?, 'paid', 'mock')
  `).run(listing.id, req.user.id, listing.price_cents, platformFeeCents, creatorEarningCents);

  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json({
    mock: true,
    note: 'Simulated payment -- no real charge was made and no money moved.',
    purchase: {
      id: purchase.id,
      listingId: purchase.listing_id,
      priceCents: purchase.price_cents,
      paymentStatus: purchase.payment_status,
      createdAt: purchase.created_at,
    },
    listing: {
      id: listing.id,
      title: listing.title,
      protocol: listing.protocol,
      configLink: listing.config_link,
    },
  });
});

// Auth required: the buyer's own purchase history, including the config
// link for each -- this is what the client uses to re-import a config it
// already owns without repurchasing.
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, l.title, l.protocol, l.region, l.config_link
    FROM purchases p
    JOIN listings l ON l.id = p.listing_id
    WHERE p.buyer_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);

  res.json({
    purchases: rows.map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      title: row.title,
      protocol: row.protocol,
      region: row.region,
      configLink: row.config_link,
      priceCents: row.price_cents,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
    })),
  });
});

module.exports = router;
