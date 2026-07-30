'use strict';

const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Auth required: aggregate creator earnings summary. Per-listing detail
// lives in GET /api/listings/mine -- this is just the dashboard rollup.
router.get('/mine', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT l.id) AS listing_count,
      COALESCE(COUNT(p.id), 0) AS total_sales,
      COALESCE(SUM(p.creator_earning_cents), 0) AS total_earnings_cents
    FROM listings l
    LEFT JOIN purchases p ON p.listing_id = l.id
    WHERE l.creator_id = ?
  `).get(req.user.id);

  res.json({
    listingCount: row.listing_count,
    totalSales: row.total_sales,
    totalEarningsCents: row.total_earnings_cents,
  });
});

module.exports = router;
