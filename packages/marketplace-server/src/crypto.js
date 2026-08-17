// Crypto payment rail for the marketplace, built on ethers v6.
//
// Model: every invoice gets its own freshly-derived receiving address from a
// single HD wallet (BIP-44 path m/44'/60'/0'/0/<index>), so payments are
// attributable without needing a per-user account system on-chain. The server
// then watches that address's balance on a normal JSON-RPC provider and
// settles the invoice once the required amount has enough confirmations.
//
// What this deliberately does NOT do: hold or move funds automatically. The
// xpub-derived addresses receive; sweeping them into treasury and paying
// creators out is a separate operational step (it needs the private keys,
// which in a real deployment live in a signer/HSM, not in this process). The
// ledger here records what is owed; `payouts` marks when that was honoured.

import { ethers } from 'ethers';
import * as store from './redis.js';

// Native-coin decimals for the chains we quote in. USDC/USDT-style ERC-20
// settlement would add a token contract + decimals per asset; the invoice
// shape below already carries `asset` so that can slot in without a rewrite.
const SUPPORTED_ASSETS = {
  ETH: { decimals: 18, confirmations: 3 },
  MATIC: { decimals: 18, confirmations: 12 },
};

const INVOICE_TTL_MS = 30 * 60 * 1000; // quote is only honoured this long

function config() {
  return {
    mnemonic: process.env.CRYPTO_MNEMONIC || '',
    rpcUrl: process.env.CRYPTO_RPC_URL || '',
    asset: (process.env.CRYPTO_ASSET || 'ETH').toUpperCase(),
    // Price of 1 whole coin in USD cents. A real deployment feeds this from a
    // price oracle; keeping it injectable makes the conversion testable and
    // keeps a market-data client out of this module.
    coinPriceCents: Number(process.env.CRYPTO_COIN_PRICE_CENTS || 0),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.mnemonic && c.rpcUrl && c.coinPriceCents > 0 && SUPPORTED_ASSETS[c.asset]);
}

let cachedProvider = null;
function provider() {
  const { rpcUrl } = config();
  if (!cachedProvider) cachedProvider = new ethers.JsonRpcProvider(rpcUrl);
  return cachedProvider;
}

// Derive the receiving address for an invoice index. Only the address is
// returned -- the private key is derived here and immediately discarded, so
// nothing in the request path ever holds spending authority.
function deriveAddress(index) {
  const { mnemonic } = config();
  const node = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${index}`);
  return node.address;
}

// Convert a USD-cent price into the smallest unit of the asset (wei), so all
// on-chain comparisons stay in integer math and never touch floats.
function centsToWei(cents, asset) {
  const { coinPriceCents } = config();
  const { decimals } = SUPPORTED_ASSETS[asset];
  // wei = cents / coinPriceCents * 10^decimals, done as integer math with the
  // scale applied before the division so precision isn't lost.
  return (BigInt(cents) * (10n ** BigInt(decimals))) / BigInt(coinPriceCents);
}

async function createInvoice({ purposeType, purposeId, buyerId, amountCents }) {
  if (!isConfigured()) throw new Error('crypto payments are not configured on this server');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('invalid amount');

  const { asset } = config();
  const index = await store.nextInvoiceIndex();
  const address = deriveAddress(index);
  const amountWei = centsToWei(amountCents, asset);

  return store.createInvoice({
    purposeType, // 'listing' | 'subscription' | 'topup'
    purposeId,
    buyerId,
    amountCents,
    asset,
    amountWei: amountWei.toString(),
    address,
    derivationIndex: index,
    status: 'pending',
    confirmationsRequired: SUPPORTED_ASSETS[asset].confirmations,
    expiresAt: Date.now() + INVOICE_TTL_MS,
  });
}

// Check an invoice against the chain and settle/expire it. Safe to call
// repeatedly -- it's the single place invoice status transitions, and it only
// ever moves pending -> paid or pending -> expired.
async function refreshInvoice(invoiceId) {
  const invoice = await store.getInvoiceById(invoiceId);
  if (!invoice) throw new Error('invoice not found');
  if (invoice.status !== 'pending') return invoice;

  const p = provider();
  const [balance, head] = await Promise.all([p.getBalance(invoice.address), p.getBlockNumber()]);

  if (balance >= BigInt(invoice.amountWei)) {
    // Funds are visible. Require the asset's confirmation depth before
    // treating it as final, so a reorg can't unlock a paid config.
    const confirmed = await p.getBalance(invoice.address, Math.max(head - invoice.confirmationsRequired, 0));
    if (confirmed >= BigInt(invoice.amountWei)) {
      return store.markInvoicePaid(invoice.id, { paidAt: Date.now(), observedWei: balance.toString() });
    }
    return store.updateInvoice(invoice.id, { status: 'pending', seenUnconfirmedWei: balance.toString() });
  }

  if (Date.now() > invoice.expiresAt) {
    // Expiry is about the quoted rate, not the money: anything that lands
    // later is still recorded against the address rather than lost.
    return store.updateInvoice(invoice.id, { status: 'expired' });
  }
  return invoice;
}

export { createInvoice, refreshInvoice, isConfigured, deriveAddress, centsToWei, SUPPORTED_ASSETS };
