// server.js
const express = require('express');
const { Client } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL client
const client = new Client({
  user: "inventoryuser",           // your current role
  host: "Gb7VPB7Nib2DwYOYU26GjISwFeDSGs3k",
  database: "inventorydb_xwhg",    // the database you created
  password: "Gb7VPB7Nib2DwYOYU26GjISwFeDSGs3k",  // the password you set during PostgreSQL install
  port: 5432
});
// const client = new Client({
//   user: "postgres",           // your current role
//   host: "localhost",
//   database: "inventorydb",    // the database you created
//   password: "18Ct2354@",  // the password you set during PostgreSQL install
//   port: 5432
// });


async function initDb() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // Create tables if not exist
    const schema = `
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS materials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      unit TEXT
    );

    CREATE TABLE IF NOT EXISTS location_materials (
      id SERIAL PRIMARY KEY,
      location_id INTEGER NOT NULL,
      material_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE(location_id, material_id),
      FOREIGN KEY(location_id) REFERENCES locations(id),
      FOREIGN KEY(material_id) REFERENCES materials(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      material_id INTEGER NOT NULL,
      from_location_id INTEGER,
      to_location_id INTEGER,
      quantity INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(material_id) REFERENCES materials(id),
      FOREIGN KEY(from_location_id) REFERENCES locations(id),
      FOREIGN KEY(to_location_id) REFERENCES locations(id)
    );
    `;
    await client.query(schema);
    console.log('✅ Tables created (if not exist)');
  } catch (err) {
    console.error('❌ DB init error', err);
  }
}
initDb();


// -------------------- Locations --------------------
app.get('/api/locations', async (req, res) => {
  try {
    const result = await client.query('SELECT id, name FROM locations ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/locations', async (req, res) => {
  const { name } = req.body;
  try {
    const result = await client.query(
      'INSERT INTO locations(name) VALUES($1) RETURNING id',
      [name]
    );
    res.json({ id: result.rows[0].id, name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// -------------------- Materials --------------------
app.get('/api/materials', async (req, res) => {
  try {
    const result = await client.query('SELECT id, name, unit FROM materials ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/materials', async (req, res) => {
  const { name, unit } = req.body;
  try {
    const result = await client.query(
      'INSERT INTO materials(name, unit) VALUES($1,$2) RETURNING id',
      [name, unit || '']
    );
    res.json({ id: result.rows[0].id, name, unit });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// -------------------- Inventory Add --------------------
app.post('/api/inventory/add', async (req, res) => {
  const { location_id, material_id, quantity } = req.body;
  if (!location_id || !material_id || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'location_id, material_id and positive integer quantity required' });
  }

  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO location_materials(location_id, material_id, quantity)
      VALUES($1,$2,$3)
      ON CONFLICT(location_id, material_id) 
      DO UPDATE SET quantity = location_materials.quantity + EXCLUDED.quantity
    `, [location_id, material_id, quantity]);

    await client.query(`
      INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type)
      VALUES($1,$2,$3,$4,$5)
    `, [material_id, null, location_id, quantity, 'add']);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});


// -------------------- Inventory Transfer --------------------
app.post('/api/inventory/transfer', async (req, res) => {
  const { from_location_id, to_location_id, material_id, quantity } = req.body;
  if (!from_location_id || !to_location_id || !material_id || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'from_location_id, to_location_id, material_id and positive integer quantity required' });
  }

  try {
    await client.query('BEGIN');

    const fromRowResult = await client.query(
      'SELECT id, quantity FROM location_materials WHERE location_id=$1 AND material_id=$2',
      [from_location_id, material_id]
    );
    const fromRow = fromRowResult.rows[0];
    if (!fromRow || fromRow.quantity < quantity) {
      throw new Error('insufficient quantity at source location');
    }

    await client.query(
      'UPDATE location_materials SET quantity = quantity - $1 WHERE id = $2',
      [quantity, fromRow.id]
    );

    await client.query(`
      INSERT INTO location_materials(location_id, material_id, quantity)
      VALUES($1,$2,$3)
      ON CONFLICT(location_id, material_id)
      DO UPDATE SET quantity = location_materials.quantity + EXCLUDED.quantity
    `, [to_location_id, material_id, quantity]);

    await client.query(`
      INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type)
      VALUES($1,$2,$3,$4,$5)
    `, [material_id, from_location_id, to_location_id, quantity, 'transfer']);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});


// -------------------- Inventory Queries --------------------
app.get('/api/inventory/all', async (req, res) => {
  try {
    const result = await client.query(`
      SELECT *
      FROM location_materials lm
      JOIN materials m ON m.id = lm.material_id
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inventory/:location_id', async (req, res) => {
  const location_id = Number(req.params.location_id);
  try {
    const result = await client.query(`
      SELECT lm.material_id, m.name as material_name, lm.quantity, m.unit
      FROM location_materials lm
      JOIN materials m ON m.id = lm.material_id
      WHERE lm.location_id = $1
    `, [location_id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// -------------------- Transactions --------------------
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await client.query(`
      SELECT t.id, t.material_id, m.name as material_name, t.from_location_id, lf.name as from_location,
             t.to_location_id, lt.name as to_location, t.quantity, t.type, t.created_at
      FROM transactions t
      LEFT JOIN materials m ON m.id = t.material_id
      LEFT JOIN locations lf ON lf.id = t.from_location_id
      LEFT JOIN locations lt ON lt.id = t.to_location_id
      ORDER BY t.id DESC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server listening on', PORT));
