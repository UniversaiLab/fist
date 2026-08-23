// Bun ships a native Redis client (Bun.redis) -- no extra dependency needed
// for storage. Connects lazily using REDIS_URL, defaulting to a local
// instance, matching how most Redis client libraries behave.
const redis = Bun.redis;

async function nextId(counterKey) {
  return redis.incr(counterKey);
}

// -------- Users --------
// user:{id}            HASH  { email, passwordHash, displayName, createdAt }
// user:email:{email}   STRING -> id  (lookup index for login)

async function createUser({ email, passwordHash, displayName }) {
  const id = String(await nextId('seq:user'));
  const createdAt = new Date().toISOString();
  await redis.hmset(`user:${id}`, [
    'email', email,
    'passwordHash', passwordHash,
    'displayName', displayName,
    'createdAt', createdAt,
  ]);
  await redis.set(`user:email:${email.toLowerCase()}`, id);
  return { id, email, displayName, createdAt };
}

async function getUserByEmail(email) {
  const id = await redis.get(`user:email:${email.toLowerCase()}`);
  if (!id) return null;
  return getUserById(id);
}

async function getUserById(id) {
  const row = await redis.hgetall(`user:${id}`);
  if (!row || !row.email) return null;
  return { id: String(id), ...row };
}

// -------- Listings --------
// listing:{id}                  HASH { creatorId, title, protocol, region, priceCents, description, configLink, status, createdAt }
// listings:live                 ZSET member=id score=createdAt(ms)  -- browse ordering
// listings:by_creator:{userId}  ZSET member=id score=createdAt(ms)  -- a creator's own listings

async function createListing({ creatorId, title, protocol, region, priceCents, description, configLink }) {
  const id = String(await nextId('seq:listing'));
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  await redis.hmset(`listing:${id}`, [
    'creatorId', String(creatorId),
    'title', title,
    'protocol', protocol,
    'region', region,
    'priceCents', String(priceCents),
    'description', description || '',
    'configLink', configLink,
    'status', 'live',
    'createdAt', createdAt,
  ]);
  await redis.zadd('listings:live', String(createdAtMs), id);
  await redis.zadd(`listings:by_creator:${creatorId}`, String(createdAtMs), id);
  return getListingById(id);
}

async function getListingById(id) {
  const row = await redis.hgetall(`listing:${id}`);
  if (!row || !row.title) return null;
  return { id: String(id), ...row, priceCents: Number(row.priceCents) };
}

async function listLiveListings() {
  const ids = await redis.zrevrange('listings:live', '0', '-1');
  const listings = await Promise.all(ids.map(getListingById));
  return listings.filter((l) => l && l.status === 'live');
}

async function listListingsByCreator(creatorId) {
  const ids = await redis.zrevrange(`listings:by_creator:${creatorId}`, '0', '-1');
  const listings = await Promise.all(ids.map(getListingById));
  return listings.filter(Boolean);
}

// -------- Purchases --------
// purchase:{id}                   HASH { listingId, buyerId, priceCents, platformFeeCents, creatorEarningCents, paymentStatus, paymentProvider, createdAt }
// purchases:by_buyer:{userId}     ZSET member=id score=createdAt(ms)  -- a buyer's order history
// sales:listing:{listingId}       STRING (counter)  -- sales count for a listing
// earnings:listing:{listingId}    STRING (counter, cents) -- lifetime earnings for a listing
// sales:creator:{userId}          STRING (counter)  -- total sales across all of a creator's listings
// earnings:creator:{userId}       STRING (counter, cents) -- total earnings across all of a creator's listings

async function createPurchase({ listing, buyerId, platformFeeCents, creatorEarningCents }) {
  const id = String(await nextId('seq:purchase'));
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  await redis.hmset(`purchase:${id}`, [
    'listingId', String(listing.id),
    'buyerId', String(buyerId),
    'priceCents', String(listing.priceCents),
    'platformFeeCents', String(platformFeeCents),
    'creatorEarningCents', String(creatorEarningCents),
    'paymentStatus', 'paid',
    'paymentProvider', 'mock',
    'createdAt', createdAt,
  ]);
  await redis.zadd(`purchases:by_buyer:${buyerId}`, String(createdAtMs), id);

  await redis.incr(`sales:listing:${listing.id}`);
  await redis.incrby(`earnings:listing:${listing.id}`, creatorEarningCents);
  await redis.incr(`sales:creator:${listing.creatorId}`);
  await redis.incrby(`earnings:creator:${listing.creatorId}`, creatorEarningCents);

  return getPurchaseById(id);
}

async function getPurchaseById(id) {
  const row = await redis.hgetall(`purchase:${id}`);
  if (!row || !row.listingId) return null;
  return { id: String(id), ...row, priceCents: Number(row.priceCents) };
}

async function listPurchasesByBuyer(buyerId) {
  const ids = await redis.zrevrange(`purchases:by_buyer:${buyerId}`, '0', '-1');
  const purchases = await Promise.all(ids.map(getPurchaseById));
  return purchases.filter(Boolean);
}

async function listingStats(listingId) {
  const [sales, earningsCents] = await Promise.all([
    redis.get(`sales:listing:${listingId}`),
    redis.get(`earnings:listing:${listingId}`),
  ]);
  return { sales: Number(sales || 0), earningsCents: Number(earningsCents || 0) };
}

async function creatorStats(creatorId) {
  const [sales, earningsCents] = await Promise.all([
    redis.get(`sales:creator:${creatorId}`),
    redis.get(`earnings:creator:${creatorId}`),
  ]);
  return { sales: Number(sales || 0), earningsCents: Number(earningsCents || 0) };
}

// -------- Ratings --------
// rating:{listingId}:{userId}   HASH  { stars, comment, createdAt }
// ratings:listing:{listingId}   ZSET  createdAtMs -> userId   (listing's reviews)
// rating:sum:{listingId}        STRING (counter) -- sum of stars, for a mean
// rating:count:{listingId}      STRING (counter) -- number of ratings
// rating:sum|count:creator:{id} STRING (counter) -- same, aggregated per creator
//
// One rating per (listing, user): re-rating overwrites in place and adjusts
// the running sums by the delta, so the aggregate never double-counts.

async function getRating(listingId, userId) {
  const row = await redis.hgetall(`rating:${listingId}:${userId}`);
  if (!row || !row.stars) return null;
  return { listingId: String(listingId), userId: String(userId), ...row, stars: Number(row.stars) };
}

async function upsertRating({ listingId, creatorId, userId, stars, comment }) {
  const existing = await getRating(listingId, userId);
  const createdAtMs = Date.now();

  await redis.hmset(`rating:${listingId}:${userId}`, [
    'stars', String(stars),
    'comment', comment || '',
    'createdAt', new Date(createdAtMs).toISOString(),
  ]);
  await redis.zadd(`ratings:listing:${listingId}`, String(createdAtMs), String(userId));

  // Apply only the difference when replacing an existing rating, so counts
  // stay accurate and the mean doesn't drift on every edit.
  const delta = stars - (existing ? existing.stars : 0);
  await redis.incrby(`rating:sum:${listingId}`, delta);
  await redis.incrby(`rating:sum:creator:${creatorId}`, delta);
  if (!existing) {
    await redis.incr(`rating:count:${listingId}`);
    await redis.incr(`rating:count:creator:${creatorId}`);
  }
  return getRating(listingId, userId);
}

async function ratingStats(listingId) {
  const [sum, count] = await Promise.all([
    redis.get(`rating:sum:${listingId}`),
    redis.get(`rating:count:${listingId}`),
  ]);
  const n = Number(count || 0);
  return { count: n, average: n ? Number(sum || 0) / n : 0 };
}

async function creatorRatingStats(creatorId) {
  const [sum, count] = await Promise.all([
    redis.get(`rating:sum:creator:${creatorId}`),
    redis.get(`rating:count:creator:${creatorId}`),
  ]);
  const n = Number(count || 0);
  return { count: n, average: n ? Number(sum || 0) / n : 0 };
}

async function listRatings(listingId, limit = 20) {
  const userIds = await redis.zrevrange(`ratings:listing:${listingId}`, '0', String(limit - 1));
  const rows = await Promise.all(userIds.map(async (uid) => {
    const [rating, user] = await Promise.all([getRating(listingId, uid), getUserById(uid)]);
    return rating ? { ...rating, displayName: user ? user.displayName : 'Unknown' } : null;
  }));
  return rows.filter(Boolean);
}

// -------- Crypto invoices --------
// invoice:{id}            HASH   full invoice record
// invoices:by_buyer:{id}  ZSET   createdAtMs -> invoiceId
// seq:invoice_index       STRING monotonic HD derivation index

async function nextInvoiceIndex() {
  return redis.incr('seq:invoice_index');
}

async function createInvoice(data) {
  const id = String(await nextId('seq:invoice'));
  const createdAtMs = Date.now();
  const record = { ...data, id, createdAt: new Date(createdAtMs).toISOString() };
  await redis.hmset(`invoice:${id}`, Object.entries(record).flatMap(([k, v]) => [k, String(v)]));
  await redis.zadd(`invoices:by_buyer:${data.buyerId}`, String(createdAtMs), id);
  return getInvoiceById(id);
}

async function getInvoiceById(id) {
  const row = await redis.hgetall(`invoice:${id}`);
  if (!row || !row.address) return null;
  return {
    ...row,
    id: String(id),
    amountCents: Number(row.amountCents),
    derivationIndex: Number(row.derivationIndex),
    confirmationsRequired: Number(row.confirmationsRequired),
    expiresAt: Number(row.expiresAt),
  };
}

async function updateInvoice(id, patch) {
  await redis.hmset(`invoice:${id}`, Object.entries(patch).flatMap(([k, v]) => [k, String(v)]));
  return getInvoiceById(id);
}

async function markInvoicePaid(id, patch) {
  return updateInvoice(id, { ...patch, status: 'paid' });
}

async function listInvoicesByBuyer(buyerId) {
  const ids = await redis.zrevrange(`invoices:by_buyer:${buyerId}`, '0', '-1');
  const rows = await Promise.all(ids.map(getInvoiceById));
  return rows.filter(Boolean);
}

export {
  redis,
  createUser,
  getUserByEmail,
  getUserById,
  getRating,
  upsertRating,
  ratingStats,
  creatorRatingStats,
  listRatings,
  nextInvoiceIndex,
  createInvoice,
  getInvoiceById,
  updateInvoice,
  markInvoicePaid,
  listInvoicesByBuyer,
  createListing,
  getListingById,
  listLiveListings,
  listListingsByCreator,
  createPurchase,
  getPurchaseById,
  listPurchasesByBuyer,
  listingStats,
  creatorStats,
};
