import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as auth from './auth.js';
import listings from './listings.js';
import purchases from './purchases.js';
import earnings from './earnings.js';

const app = new Hono();
app.use('*', cors());

app.get('/api/health', (c) => c.json({
  ok: true,
  mock: true,
  note: 'Marketplace backend -- payments are simulated, no real money moves.',
}));

app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);

app.route('/api/listings', listings);
app.route('/api/purchases', purchases);
app.route('/api/earnings', earnings);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal server error' }, 500);
});

const port = Number(process.env.PORT) || 4310;
console.log(`[marketplace-server] listening on http://localhost:${port} (mocked payments -- no real money moves)`);

export default { port, fetch: app.fetch };
