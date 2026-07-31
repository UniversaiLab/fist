'use strict';

const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

const PROTOCOLS = new Set(['vless', 'trojan', 'ss', 'hysteria2', 'vmess']);

function publicListing(row) {
  return {
    id: row.id,
    title: row.title,
    protocol: row.protocol,
    region: row.region,
    priceCents: row.price_cents,
    description: row.description,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    sales: row.sales,
    createdAt: row.created_at,
    // Note: config_link is withheld here on purpose -- it's only
    // returned to whoever actually bought the listing (see purchases.js).
  };
}

// Public: browse all live listings.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM purchases p WHERE p.listing_id = l.id) AS sales
    FROM listings l
    JOIN users u ON u.id = l.creator_id
    WHERE l.status = 'live'
    ORDER BY l.created_at DESC
  `).all();
  res.json({ listings: rows.map(publicListing) });
});

// Auth required: a creator's own listings, including earnings per listing.
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM purchases p WHERE p.listing_id = l.id) AS sales,
      (SELECT COALESCE(SUM(p.creator_earning_cents), 0) FROM purchases p WHERE p.listing_id = l.id) AS earnings_cents
    FROM listings l
    WHERE l.creator_id = ?
    ORDER BY l.created_at DESC
  `).all(req.user.id);

  res.json({
    listings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      protocol: row.protocol,
      region: row.region,
      priceCents: row.price_cents,
      description: row.description,
      configLink: row.config_link,
      status: row.status,
      sales: row.sales,
      earningsCents: row.earnings_cents,
      createdAt: row.created_at,
    })),
  });
});

// Auth required: publish a new listing.
router.post('/', requireAuth, (req, res) => {
  const { title, protocol, region, priceCents, description, configLink } = req.body || {};
  if (!title || !protocol || !region || !configLink) {
    return res.status(400).json({ error: 'title, protocol, region, and configLink are required' });
  }
  if (!PROTOCOLS.has(protocol)) {
    return res.status(400).json({ error: `protocol must be one of: ${Array.from(PROTOCOLS).join(', ')}` });
  }
  const cents = Number(priceCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    return res.status(400).json({ error: 'priceCents must be a positive integer (price in cents)' });
  }

  const info = db.prepare(`
    INSERT INTO listings (creator_id, title, protocol, region, price_cents, description, config_link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, title, protocol, region, cents, description || '', configLink);

  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({
    listing: {
      id: row.id,
      title: row.title,
      protocol: row.protocol,
      region: row.region,
      priceCents: row.price_cents,
      description: row.description,
      configLink: row.config_link,
      status: row.status,
      sales: 0,
      earningsCents: 0,
      createdAt: row.created_at,
    },
  });
});

module.exports = router;
