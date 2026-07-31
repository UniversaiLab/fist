import { Hono } from 'hono';
import * as store from './redis.js';
import { requireAuth } from './auth.js';

const earnings = new Hono();

// Auth required: aggregate creator earnings summary. Per-listing detail
// lives in GET /api/listings/mine -- this is just the dashboard rollup.
earnings.get('/mine', requireAuth, async (c) => {
  const user = c.get('user');
  const [stats, listings] = await Promise.all([
    store.creatorStats(user.id),
    store.listListingsByCreator(user.id),
  ]);

  return c.json({
    listingCount: listings.length,
    totalSales: stats.sales,
    totalEarningsCents: stats.earningsCents,
  });
});

export default earnings;
