'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'marketplace.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    protocol TEXT NOT NULL,
    region TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    description TEXT NOT NULL DEFAULT '',
    config_link TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'delisted')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    price_cents INTEGER NOT NULL,
    platform_fee_cents INTEGER NOT NULL,
    creator_earning_cents INTEGER NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'paid',
    payment_provider TEXT NOT NULL DEFAULT 'mock',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_listings_creator ON listings(creator_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_listing ON purchases(listing_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_id);
`);

module.exports = db;
