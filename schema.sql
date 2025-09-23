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
  FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL,
  from_location_id INTEGER,
  to_location_id INTEGER,
  quantity INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY(from_location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY(to_location_id) REFERENCES locations(id) ON DELETE SET NULL
);
