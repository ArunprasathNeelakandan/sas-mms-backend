const express = require('express');
const db = require('./db');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Locations
app.get('/api/locations', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM locations ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/locations', (req, res) => {
  const { name } = req.body;
  try {
    const info = db.prepare('INSERT INTO locations(name) VALUES(?)').run(name);
    res.json({ id: info.lastInsertRowid, name });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// Materials
app.get('/api/materials', (req, res) => {
  const rows = db.prepare('SELECT id, name, unit FROM materials ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/materials', (req, res) => {
  const { name, unit } = req.body;
  try {
    const info = db.prepare('INSERT INTO materials(name, unit) VALUES(?,?)').run(name, unit || '');
    res.json({ id: info.lastInsertRowid, name, unit });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// Add inventory (increase quantity at location) - also logs transaction
app.post('/api/inventory/add', (req, res) => {
  const { location_id, material_id, quantity } = req.body;
  if(!location_id || !material_id || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'location_id, material_id and positive integer quantity required' });
  }
  const insertOrUpdate = db.prepare(`
    INSERT INTO location_materials(location_id, material_id, quantity)
    VALUES(?,?,?)
    ON CONFLICT(location_id, material_id) DO UPDATE SET quantity = quantity + excluded.quantity
  `);
  const tx = db.transaction(() => {
    insertOrUpdate.run(location_id, material_id, quantity);
    db.prepare('INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type) VALUES(?,?,?,?,?)')
      .run(material_id, null, location_id, quantity, 'add');
  });
  try {
    tx();
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Transfer between locations
app.post('/api/inventory/transfer', (req, res) => {
  const { from_location_id, to_location_id, material_id, quantity } = req.body;
  if(!from_location_id || !to_location_id || !material_id || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'from_location_id, to_location_id, material_id and positive integer quantity required' });
  }
  const tx = db.transaction(() => {
    const fromRow = db.prepare('SELECT id, quantity FROM location_materials WHERE location_id=? AND material_id=?').get(from_location_id, material_id);
    if(!fromRow || fromRow.quantity < quantity) {
      throw new Error('insufficient quantity at source location');
    }
    db.prepare('UPDATE location_materials SET quantity = quantity - ? WHERE id = ?').run(quantity, fromRow.id);
    db.prepare(`
      INSERT INTO location_materials(location_id, material_id, quantity)
      VALUES(?,?,?)
      ON CONFLICT(location_id, material_id) DO UPDATE SET quantity = quantity + excluded.quantity
    `).run(to_location_id, material_id, quantity);
    db.prepare('INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type) VALUES(?,?,?,?,?)')
      .run(material_id, from_location_id, to_location_id, quantity, 'transfer');
  });
  try {
    tx();
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/inventory/all', (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM location_materials lm
    JOIN materials m ON m.id = lm.material_id
  `).all();
  res.json(rows);
});

// Get inventory for a location
app.get('/api/inventory/:location_id', (req, res) => {
  const location_id = Number(req.params.location_id);
  const rows = db.prepare(`
    SELECT lm.material_id, m.name as material_name, lm.quantity, m.unit
    FROM location_materials lm
    JOIN materials m ON m.id = lm.material_id
    WHERE lm.location_id = ?
  `).all(location_id);
  res.json(rows);
});

// Transactions list
app.get('/api/transactions', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.material_id, m.name as material_name, t.from_location_id, lf.name as from_location,
           t.to_location_id, lt.name as to_location, t.quantity, t.type, t.created_at
    FROM transactions t
    LEFT JOIN materials m ON m.id = t.material_id
    LEFT JOIN locations lf ON lf.id = t.from_location_id
    LEFT JOIN locations lt ON lt.id = t.to_location_id
    ORDER BY t.id DESC
  `).all();
  res.json(rows);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server listening on', PORT));
