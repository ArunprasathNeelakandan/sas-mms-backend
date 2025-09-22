const express = require('express');
const db = require('./db');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());



// Locations
app.get('/api/locations', (req, res) => {
  db.all('SELECT id, name FROM locations ORDER BY id DESC', (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows); // rows is an array
  });
});

app.post('/api/locations', (req, res) => {
  const { name } = req.body;

  const sql = 'INSERT INTO locations(name) VALUES(?)';
  db.run(sql, [name], function(err) {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: err.message });
    }

    // `this.lastID` gives the ID of the inserted row
    res.json({ id: this.lastID, name });
  });
});

// Materials
app.get('/api/materials', (req, res) => {
  const sql = 'SELECT id, name, unit FROM materials ORDER BY id DESC';
  db.all(sql, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows); // rows is an array
  });
});

app.post('/api/materials', (req, res) => {
  const { name, unit } = req.body;

  const sql = 'INSERT INTO materials(name, unit) VALUES(?, ?)';
  db.run(sql, [name, unit || ''], function(err) {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: err.message });
    }

    // `this.lastID` gives the ID of the inserted row
    res.json({ id: this.lastID, name, unit });
  });
});

// Add inventory (increase quantity at location) - also logs transaction

app.post('/api/inventory/add', (req, res) => {
  const { location_id, material_id, quantity } = req.body;

  if (!location_id || !material_id || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'location_id, material_id and positive integer quantity required' });
  }

  // Begin transaction
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // Step 1: Insert or update quantity in location_materials
    db.get(
      `SELECT quantity FROM location_materials WHERE location_id = ? AND material_id = ?`,
      [location_id, material_id],
      (err, row) => {
        if (err) {
          console.error(err);
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        if (row) {
          // Row exists → update quantity
          db.run(
            `UPDATE location_materials SET quantity = quantity + ? WHERE location_id = ? AND material_id = ?`,
            [quantity, location_id, material_id],
            (err) => {
              if (err) {
                console.error(err);
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }
              insertTransaction();
            }
          );
        } else {
          // Row does not exist → insert new
          db.run(
            `INSERT INTO location_materials(location_id, material_id, quantity) VALUES (?, ?, ?)`,
            [location_id, material_id, quantity],
            (err) => {
              if (err) {
                console.error(err);
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }
              insertTransaction();
            }
          );
        }
      }
    );

    // Step 2: Insert into transactions table
    function insertTransaction() {
      db.run(
        `INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type) VALUES (?, ?, ?, ?, ?)`,
        [material_id, null, location_id, quantity, 'add'],
        (err) => {
          if (err) {
            console.error(err);
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
          db.run("COMMIT", (err) => {
            if (err) {
              console.error(err);
              return res.status(500).json({ error: err.message });
            }
            res.json({ ok: true });
          });
        }
      );
    }
  });
});

// Transfer between locations
app.post('/api/inventory/transfer', (req, res) => {
  const { from_location_id, to_location_id, material_id, quantity } = req.body;

  if (
    !from_location_id ||
    !to_location_id ||
    !material_id ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return res.status(400).json({ error: 'from_location_id, to_location_id, material_id and positive integer quantity required' });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // Step 1: Check quantity at source
    db.get(
      'SELECT id, quantity FROM location_materials WHERE location_id=? AND material_id=?',
      [from_location_id, material_id],
      (err, fromRow) => {
        if (err) {
          console.error(err);
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        if (!fromRow || fromRow.quantity < quantity) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: 'insufficient quantity at source location' });
        }

        // Step 2: Deduct quantity from source
        db.run(
          'UPDATE location_materials SET quantity = quantity - ? WHERE id = ?',
          [quantity, fromRow.id],
          (err) => {
            if (err) {
              console.error(err);
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }

            // Step 3: Add quantity to destination (insert or update)
            db.get(
              'SELECT id, quantity FROM location_materials WHERE location_id=? AND material_id=?',
              [to_location_id, material_id],
              (err, toRow) => {
                if (err) {
                  console.error(err);
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }

                if (toRow) {
                  // Exists → update
                  db.run(
                    'UPDATE location_materials SET quantity = quantity + ? WHERE id = ?',
                    [quantity, toRow.id],
                    insertTransaction
                  );
                } else {
                  // Does not exist → insert
                  db.run(
                    'INSERT INTO location_materials(location_id, material_id, quantity) VALUES(?, ?, ?)',
                    [to_location_id, material_id, quantity],
                    insertTransaction
                  );
                }

                // Step 4: Insert transaction record
                function insertTransaction(err) {
                  if (err) {
                    console.error(err);
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                  }

                  db.run(
                    'INSERT INTO transactions(material_id, from_location_id, to_location_id, quantity, type) VALUES(?,?,?,?,?)',
                    [material_id, from_location_id, to_location_id, quantity, 'transfer'],
                    (err) => {
                      if (err) {
                        console.error(err);
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                      }

                      db.run("COMMIT", (err) => {
                        if (err) {
                          console.error(err);
                          return res.status(500).json({ error: err.message });
                        }
                        res.json({ ok: true });
                      });
                    }
                  );
                }
              }
            );
          }
        );
      }
    );
  });
});


app.get('/api/inventory/all', (req, res) => {
  const sql = `
    SELECT *
    FROM location_materials lm
    JOIN materials m ON m.id = lm.material_id
  `;

  db.all(sql, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows); // rows is always an array
  });
});

// Get inventory for a location
app.get('/api/inventory/:location_id', (req, res) => {
  const location_id = Number(req.params.location_id);

  const sql = `
    SELECT lm.material_id, m.name as material_name, lm.quantity, m.unit
    FROM location_materials lm
    JOIN materials m ON m.id = lm.material_id
    WHERE lm.location_id = ?
  `;

  db.all(sql, [location_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows); // rows is an array
  });
});
// Transactions list
app.get('/api/transactions', (req, res) => {
  const sql = `
    SELECT t.id, t.material_id, m.name as material_name, t.from_location_id, lf.name as from_location,
           t.to_location_id, lt.name as to_location, t.quantity, t.type, t.created_at
    FROM transactions t
    LEFT JOIN materials m ON m.id = t.material_id
    LEFT JOIN locations lf ON lf.id = t.from_location_id
    LEFT JOIN locations lt ON lt.id = t.to_location_id
    ORDER BY t.id DESC
  `;

  db.all(sql, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows); // rows is always an array
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server listening on', PORT));
