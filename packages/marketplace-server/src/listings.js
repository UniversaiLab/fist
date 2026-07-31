import { Hono } from 'hono';
import * as store from './redis.js';
import { requireAuth } from './auth.js';

const listings = new Hono();

const PROTOCOLS = new Set(['vless', 'trojan', 'ss', 'hysteria2', 'vmess']);

function publicListing(row, stats) {
  return {
    id: row.id,
    title: row.title,
    protocol: row.protocol,
    region: row.region,
    priceCents: row.priceCents,
    description: row.description,
    creatorId: row.creatorId,
    sales: stats.sales,
    createdAt: row.createdAt,
    // config_link is withheld here on purpose -- it's only returned to
    // whoever actually bought the listing (see purchases.js).
  };
}

// Public: browse all live listings.
listings.get('/', async (c) => {
  const rows = await store.listLiveListings();
  const withStats = await Promise.all(rows.map(async (row) => {
    const stats = await store.listingStats(row.id);
    const creator = await store.getUserById(row.creatorId);
    return { ...publicListing(row, stats), creatorName: creator ? creator.displayName : 'Unknown' };
  }));
  return c.json({ listings: withStats });
});

// Auth required: a creator's own listings, including earnings per listing.
listings.get('/mine', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await store.listListingsByCreator(user.id);
  const withStats = await Promise.all(rows.map(async (row) => {
    const stats = await store.listingStats(row.id);
    return {
      id: row.id,
      title: row.title,
      protocol: row.protocol,
      region: row.region,
      priceCents: row.priceCents,
      description: row.description,
      configLink: row.configLink,
      status: row.status,
      sales: stats.sales,
      earningsCents: stats.earningsCents,
      createdAt: row.createdAt,
    };
  }));
  return c.json({ listings: withStats });
});

// Auth required: publish a new listing.
listings.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { title, protocol, region, priceCents, description, configLink } = body;

  if (!title || !protocol || !region || !configLink) {
    return c.json({ error: 'title, protocol, region, and configLink are required' }, 400);
  }
  if (!PROTOCOLS.has(protocol)) {
    return c.json({ error: `protocol must be one of: ${Array.from(PROTOCOLS).join(', ')}` }, 400);
  }
  const cents = Number(priceCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    return c.json({ error: 'priceCents must be a positive integer (price in cents)' }, 400);
  }

  const listing = await store.createListing({
    creatorId: user.id,
    title,
    protocol,
    region,
    priceCents: cents,
    description,
    configLink,
  });

  return c.json({
    listing: {
      id: listing.id,
      title: listing.title,
      protocol: listing.protocol,
      region: listing.region,
      priceCents: listing.priceCents,
      description: listing.description,
      configLink: listing.configLink,
      status: listing.status,
      sales: 0,
      earningsCents: 0,
      createdAt: listing.createdAt,
    },
  }, 201);
});

export default listings;
