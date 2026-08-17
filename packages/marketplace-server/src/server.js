import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as auth from './auth.js';
import listings from './listings.js';
import purchases from './purchases.js';
import earnings from './earnings.js';
import ratings from './ratings.js';
import payments from './payments.js';
import { isConfigured as cryptoConfigured } from './crypto.js';

const app = new Hono();
app.use('*', cors());

app.get('/api/health', (c) => c.json({
  ok: true,
  // Real settlement is available whenever the crypto rail is configured
  // (CRYPTO_MNEMONIC / CRYPTO_RPC_URL / CRYPTO_COIN_PRICE_CENTS). Without
  // that config the legacy /api/purchases route still simulates payment.
  cryptoEnabled: cryptoConfigured(),
  note: cryptoConfigured()
    ? 'Marketplace backend -- crypto settlement enabled.'
    : 'Marketplace backend -- crypto not configured; /api/purchases simulates payment only.',
}));

app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);

app.route('/api/listings', listings);
app.route('/api/purchases', purchases);
app.route('/api/earnings', earnings);
app.route('/api/ratings', ratings);
app.route('/api/payments', payments);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal server error' }, 500);
});

const port = Number(process.env.PORT) || 4310;
console.log(`[marketplace-server] listening on http://localhost:${port}`
  + (cryptoConfigured() ? ' (crypto settlement enabled)' : ' (crypto not configured -- simulated payments only)'));

export default { port, fetch: app.fetch };
