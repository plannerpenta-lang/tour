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
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','completada','expirada','abandonada')),
  ubicacion TEXT,
  iniciada_en TEXT NOT NULL,
  ultima_actividad_en TEXT NOT NULL,
  completada_en TEXT,
  premio TEXT
);

CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS platos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  emoji TEXT NOT NULL,
  puntos INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  stock_inicial INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  emoji TEXT NOT NULL,
  precio REAL NOT NULL,
  puntos INTEGER NOT NULL,
  estacion TEXT NOT NULL DEFAULT 'e2'
);
`);

try { db.exec("ALTER TABLE sesiones ADD COLUMN ubicacion TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE visitas ADD COLUMN detalle TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE productos ADD COLUMN estacion TEXT NOT NULL DEFAULT 'e2'"); } catch (_) {}

function ahora() {
  return new Date().toISOString();
}

function obtenerConfig(clave, defecto) {
  const fila = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return fila ? fila.valor : defecto;
}

function guardarConfig(clave, valor) {
  db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, String(valor));
}

guardarConfig('staff_pin', obtenerConfig('staff_pin', process.env.STAFF_PIN || '1234'));
guardarConfig('timeout_min', obtenerConfig('timeout_min', process.env.SESSION_TIMEOUT_MIN || '15'));

module.exports = { db, ahora, obtenerConfig, guardarConfig };
