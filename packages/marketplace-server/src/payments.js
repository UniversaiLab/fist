import { Hono } from 'hono';
import * as store from './redis.js';
import * as crypto from './crypto.js';
import { requireAuth } from './auth.js';

const payments = new Hono();

// Platform margin taken from every config sale, in basis points so it can be
// tuned without touching rounding logic. 2000 bps = 20%.
const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS || 2000);

function splitFee(priceCents) {
  const platformFeeCents = Math.round((priceCents * PLATFORM_FEE_BPS) / 10000);
  return { platformFeeCents, creatorEarningCents: priceCents - platformFeeCents };
}

// Is crypto settlement actually wired up on this deployment?
payments.get('/config', (c) => c.json({
  cryptoEnabled: crypto.isConfigured(),
  assets: Object.keys(crypto.SUPPORTED_ASSETS),
  platformFeeBps: PLATFORM_FEE_BPS,
}));

// Auth required: open an invoice for a listing. Returns the address and the
// exact amount to send; the config itself stays withheld until the invoice
// settles on-chain (see the claim route below).
payments.post('/invoice', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const listing = await store.getListingById(body.listingId);
  if (!listing || listing.status !== 'live') {
    return c.json({ error: 'listing not found or no longer available' }, 404);
  }
  if (String(listing.creatorId) === String(user.id)) {
    return c.json({ error: 'you cannot buy your own listing' }, 400);
  }

  try {
    const invoice = await crypto.createInvoice({
      purposeType: 'listing',
      purposeId: listing.id,
      buyerId: user.id,
      amountCents: listing.priceCents,
    });
    return c.json({ invoice: publicInvoice(invoice) }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 503);
  }
});

// Never leak the derivation index -- it maps invoices onto the HD tree and is
// operationally sensitive even though it isn't a key by itself.
function publicInvoice(inv) {
  return {
    id: inv.id,
    status: inv.status,
    asset: inv.asset,
    address: inv.address,
    amountWei: inv.amountWei,
    amountCents: inv.amountCents,
    confirmationsRequired: inv.confirmationsRequired,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    paidAt: inv.paidAt,
  };
}

// Poll an invoice. Re-checks the chain, so the client just calls this on a
// timer rather than needing a webhook endpoint exposed to the internet.
payments.get('/invoice/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const existing = await store.getInvoiceById(c.req.param('id'));
  if (!existing) return c.json({ error: 'invoice not found' }, 404);
  if (String(existing.buyerId) !== String(user.id)) return c.json({ error: 'not your invoice' }, 403);

  try {
    return c.json({ invoice: publicInvoice(await crypto.refreshInvoice(existing.id)) });
  } catch (err) {
    return c.json({ error: err.message }, 503);
  }
});

// Auth required: turn a settled invoice into an actual purchase and hand over
// the config. Idempotent -- claiming twice returns the same purchase instead
// of double-crediting the creator.
payments.post('/invoice/:id/claim', requireAuth, async (c) => {
  const user = c.get('user');
  const invoice = await store.getInvoiceById(c.req.param('id'));
  if (!invoice) return c.json({ error: 'invoice not found' }, 404);
  if (String(invoice.buyerId) !== String(user.id)) return c.json({ error: 'not your invoice' }, 403);

  const fresh = await crypto.refreshInvoice(invoice.id).catch(() => invoice);
  if (fresh.status !== 'paid') {
    return c.json({ error: 'invoice has not been paid yet', invoice: publicInvoice(fresh) }, 409);
  }
  if (fresh.purchaseId) {
    const existing = await store.getPurchaseById(fresh.purchaseId);
    if (existing) return c.json({ purchase: existing, alreadyClaimed: true });
  }

  const listing = await store.getListingById(fresh.purposeId);
  if (!listing) return c.json({ error: 'listing no longer exists' }, 410);

  const { platformFeeCents, creatorEarningCents } = splitFee(listing.priceCents);
  const purchase = await store.createPurchase({
    listing,
    buyerId: user.id,
    platformFeeCents,
    creatorEarningCents,
  });
  await store.updateInvoice(fresh.id, { purchaseId: purchase.id });

  return c.json({
    purchase,
    listing: { id: listing.id, title: listing.title, protocol: listing.protocol, configLink: listing.configLink },
  }, 201);
});

// Auth required: this user's invoice history.
payments.get('/invoices', requireAuth, async (c) => {
  const rows = await store.listInvoicesByBuyer(c.get('user').id);
  return c.json({ invoices: rows.map(publicInvoice) });
});

export default payments;
export { splitFee, PLATFORM_FEE_BPS };
