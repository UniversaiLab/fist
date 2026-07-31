import { Hono } from 'hono';
import * as store from './redis.js';
import { requireAuth } from './auth.js';

const purchases = new Hono();

// Flat platform commission. In a real system this would vary by plan/tier;
// here it's just illustrative.
const PLATFORM_FEE_RATE = 0.2;

// Auth required: buy a listing. Payment is entirely simulated -- no card is
// charged, no external processor is called. The point is to exercise the
// rest of the marketplace mechanics (ledger, config delivery) end to end.
purchases.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const listing = await store.getListingById(body.listingId);

  if (!listing || listing.status !== 'live') {
    return c.json({ error: 'listing not found or no longer available' }, 404);
  }
  if (String(listing.creatorId) === String(user.id)) {
    return c.json({ error: 'you cannot buy your own listing' }, 400);
  }

  const platformFeeCents = Math.round(listing.priceCents * PLATFORM_FEE_RATE);
  const creatorEarningCents = listing.priceCents - platformFeeCents;

  const purchase = await store.createPurchase({
    listing,
    buyerId: user.id,
    platformFeeCents,
    creatorEarningCents,
  });

  return c.json({
    mock: true,
    note: 'Simulated payment -- no real charge was made and no money moved.',
    purchase: {
      id: purchase.id,
      listingId: purchase.listingId,
      priceCents: purchase.priceCents,
      paymentStatus: purchase.paymentStatus,
      createdAt: purchase.createdAt,
    },
    listing: {
      id: listing.id,
      title: listing.title,
      protocol: listing.protocol,
      configLink: listing.configLink,
    },
  }, 201);
});

// Auth required: the buyer's own purchase history, including the config
// link for each -- this is what the client uses to re-import a config it
// already owns without repurchasing.
purchases.get('/mine', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await store.listPurchasesByBuyer(user.id);

  const withListing = await Promise.all(rows.map(async (row) => {
    const listing = await store.getListingById(row.listingId);
    return {
      id: row.id,
      listingId: row.listingId,
      title: listing ? listing.title : null,
      protocol: listing ? listing.protocol : null,
      region: listing ? listing.region : null,
      configLink: listing ? listing.configLink : null,
      priceCents: row.priceCents,
      paymentStatus: row.paymentStatus,
      createdAt: row.createdAt,
    };
  }));

  return c.json({ purchases: withListing });
});

export default purchases;
