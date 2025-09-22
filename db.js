// const Database = require('better-sqlite3');
const path = require('path');
// const db = new Database(path.resolve(__dirname, 'data.db'));

const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("data.db");

// Create tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT
);

CREATE TABLE IF NOT EXISTS location_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE(location_id, material_id),
  FOREIGN KEY(location_id) REFERENCES locations(id),
  FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  from_location_id INTEGER,
  to_location_id INTEGER,
  quantity INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'add' or 'transfer' or 'remove'
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(material_id) REFERENCES materials(id),
  FOREIGN KEY(from_location_id) REFERENCES locations(id),
  FOREIGN KEY(to_location_id) REFERENCES locations(id)
);
`);

module.exports = db;
