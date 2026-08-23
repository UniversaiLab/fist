import { Hono } from 'hono';
import * as store from './redis.js';
import { requireAuth } from './auth.js';

const ratings = new Hono();

const MAX_COMMENT = 1000;

// Public: the reviews on a listing, newest first, plus the aggregate.
ratings.get('/listing/:id', async (c) => {
  const listingId = c.req.param('id');
  const [stats, rows] = await Promise.all([
    store.ratingStats(listingId),
    store.listRatings(listingId),
  ]);
  return c.json({ ...stats, ratings: rows });
});

// Public: a creator's reputation across every listing they've published.
ratings.get('/creator/:id', async (c) => {
  return c.json(await store.creatorRatingStats(c.req.param('id')));
});

// Auth required: rate a listing you bought. Gating on purchase is what keeps
// this from being a drive-by review box -- you can only speak to a config you
// actually paid for, and only once (re-rating replaces your previous score).
ratings.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return c.json({ error: 'stars must be an integer from 1 to 5' }, 400);
  }
  const comment = String(body.comment || '').slice(0, MAX_COMMENT);

  const listing = await store.getListingById(body.listingId);
  if (!listing) return c.json({ error: 'listing not found' }, 404);
  if (String(listing.creatorId) === String(user.id)) {
    return c.json({ error: 'you cannot rate your own listing' }, 400);
  }

  const purchases = await store.listPurchasesByBuyer(user.id);
  const bought = purchases.some((p) => String(p.listingId) === String(listing.id) && p.paymentStatus === 'paid');
  if (!bought) return c.json({ error: 'you can only rate a config you have purchased' }, 403);

  const rating = await store.upsertRating({
    listingId: listing.id,
    creatorId: listing.creatorId,
    userId: user.id,
    stars,
    comment,
  });
  return c.json({ rating, stats: await store.ratingStats(listing.id) }, 201);
});

export default ratings;
