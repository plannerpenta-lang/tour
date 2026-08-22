const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'tour.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  consentimiento INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  avatar TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible','en_tour'))
);

CREATE TABLE IF NOT EXISTS estaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('registro','estacion','final')),
  puntos INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  personaje_id INTEGER NOT NULL REFERENCES personajes(id),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','completada','expirada')),
  iniciada_en TEXT NOT NULL,
  ultima_actividad_en TEXT NOT NULL,
  completada_en TEXT,
  premio TEXT
);

CREATE TABLE IF NOT EXISTS visitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id INTEGER NOT NULL REFERENCES sesiones(id),
  estacion_id INTEGER NOT NULL REFERENCES estaciones(id),
  puntos INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL,
  UNIQUE (sesion_id, estacion_id)
);

CREATE TABLE IF NOT EXISTS premios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  valor TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible','entregado')),
  sesion_id INTEGER REFERENCES sesiones(id)
);
`);

function ahora() {
  return new Date().toISOString();
}

module.exports = { db, ahora };
