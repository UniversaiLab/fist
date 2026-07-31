'use strict';

const express = require('express');
const cors = require('cors');
const auth = require('./auth');
const listingsRouter = require('./listings');
const purchasesRouter = require('./purchases');
const earningsRouter = require('./earnings');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: true, note: 'Marketplace backend -- payments are simulated, no real money moves.' });
});

app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);

app.use('/api/listings', listingsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/earnings', earningsRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 4310;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[marketplace-server] listening on http://localhost:${PORT} (mocked payments -- no real money moves)`);
  });
}

module.exports = app;
