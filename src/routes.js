const express = require('express');
const { db, ahora } = require('./db');

const router = express.Router();

function emitir(io, evento, datos) {
  if (io) io.emit(evento, datos);
}

// ---- Personajes ----

router.get('/personajes', (req, res) => {
  const { estado } = req.query;
  const filas = estado
    ? db.prepare('SELECT * FROM personajes WHERE estado = ? ORDER BY id').all(estado)
    : db.prepare('SELECT * FROM personajes ORDER BY id').all();
  res.json(filas);
});

// ---- Registro de usuario ----

router.post('/usuarios', (req, res) => {
  const { nombre, telefono, email, consentimiento } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!consentimiento) return res.status(400).json({ error: 'Se requiere el consentimiento de datos' });
  const r = db.prepare('INSERT INTO usuarios (nombre, telefono, email, consentimiento, creado_en) VALUES (?, ?, ?, 1, ?)')
    .run(nombre.trim(), telefono || null, email || null, ahora());
  res.status(201).json({ id: Number(r.lastInsertRowid), nombre: nombre.trim() });
});

// ---- Sesiones ----

router.post('/sesiones', (req, res) => {
  const { usuario_id, personaje_id } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario_id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  db.exec('BEGIN');
  try {
    const personaje = db.prepare("SELECT * FROM personajes WHERE id = ?").get(personaje_id);
    if (!personaje) throw Object.assign(new Error('Personaje no encontrado'), { status: 404 });
    if (personaje.estado !== 'disponible') throw Object.assign(new Error('Ese personaje acaba de ser tomado por otro usuario'), { status: 409 });

    db.prepare("UPDATE personajes SET estado = 'en_tour' WHERE id = ?").run(personaje_id);
    const t = ahora();
    const r = db.prepare(`INSERT INTO sesiones (usuario_id, personaje_id, estado, iniciada_en, ultima_actividad_en)
      VALUES (?, ?, 'activa', ?, ?)`).run(usuario_id, personaje_id, t, t);

    db.exec('COMMIT');
    const sesion = { id: Number(r.lastInsertRowid), usuario_id, personaje_id };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'sesion_iniciada', sesion, personaje_id });
    res.status(201).json(sesion);
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  }
});

// El totem identifica al usuario por su personaje
router.post('/totem/login', (req, res) => {
  const { personaje_id } = req.body || {};
  const fila = db.prepare(`
    SELECT s.id AS sesion_id, s.estado, u.nombre AS usuario, p.nombre AS personaje, p.avatar,
           COALESCE((SELECT SUM(puntos) FROM visitas WHERE sesion_id = s.id), 0) AS puntos
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    JOIN personajes p ON p.id = s.personaje_id
    WHERE s.personaje_id = ? AND s.estado = 'activa'
  `).get(personaje_id);

  if (!fila) return res.status(404).json({ error: 'Este personaje no tiene un recorrido activo' });

  db.prepare('UPDATE sesiones SET ultima_actividad_en = ? WHERE id = ?').run(ahora(), fila.sesion_id);
  fila.visitadas = db.prepare(`
    SELECT e.codigo, e.nombre, v.puntos
    FROM visitas v JOIN estaciones e ON e.id = v.estacion_id
    WHERE v.sesion_id = ? ORDER BY e.orden
  `).all(fila.sesion_id);
  res.json(fila);
});

// ---- Visitas a estaciones ----

router.post('/visitas', (req, res) => {
  const { sesion_id, estacion_codigo, puntos } = req.body || {};
  const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
  if (!sesion) return res.status(404).json({ error: 'Sesión activa no encontrada' });

  const estacion = db.prepare('SELECT * FROM estaciones WHERE codigo = ?').get(estacion_codigo);
  if (!estacion) return res.status(404).json({ error: 'Estación no encontrada' });

  try {
    const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp) VALUES (?, ?, ?, ?)')
      .run(sesion_id, estacion.id, puntos ?? estacion.puntos, ahora());
    db.prepare('UPDATE sesiones SET ultima_actividad_en = ? WHERE id = ?').run(ahora(), sesion_id);
    const visita = { id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
    res.status(201).json(visita);
  } catch (e) {
    res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
  }
});

// ---- Finalización y premio ----

router.post('/finalizar', (req, res) => {
  const { sesion_id } = req.body || {};
  db.exec('BEGIN');
  try {
    const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
    if (!sesion) throw Object.assign(new Error('Sesión activa no encontrada'), { status: 404 });

    const premio = db.prepare("SELECT * FROM premios WHERE estado = 'disponible' ORDER BY id LIMIT 1").get();

    let valorPremio = null;
    if (premio) {
      valorPremio = premio.valor;
      db.prepare("UPDATE premios SET estado = 'entregado', sesion_id = ? WHERE id = ?").run(sesion_id, premio.id);
    }

    const t = ahora();
    db.prepare("UPDATE sesiones SET estado = 'completada', completada_en = ?, premio = ?, ultima_actividad_en = ? WHERE id = ?")
      .run(t, valorPremio, t, sesion_id);
    db.prepare("UPDATE personajes SET estado = 'disponible' WHERE id = ?").run(sesion.personaje_id);

    db.exec('COMMIT');
    const resultado = { sesion_id, premio: valorPremio, personaje_liberado: true };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'premio_entregado', ...resultado });
    res.json(resultado);
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Estaciones y dashboard ----

router.get('/estaciones', (req, res) => {
  res.json(db.prepare('SELECT * FROM estaciones ORDER BY orden').all());
});

router.get('/dashboard', (req, res) => {
  const activas = db.prepare(`
    SELECT s.id AS sesion_id, u.nombre AS usuario, p.avatar, p.nombre AS personaje,
           s.iniciada_en, s.ultima_actividad_en,
           COALESCE((SELECT SUM(puntos) FROM visitas WHERE sesion_id = s.id), 0) AS puntos,
           (SELECT COUNT(*) FROM visitas WHERE sesion_id = s.id) AS estaciones_visitadas
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    JOIN personajes p ON p.id = s.personaje_id
    WHERE s.estado = 'activa'
    ORDER BY s.iniciada_en
  `).all();

  const hoy = new Date().toISOString().slice(0, 10);
  const totales = {
    tours_completados_hoy: db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE estado = 'completada' AND completada_en LIKE ?").get(`${hoy}%`).n,
    tours_expirados_hoy: db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE estado = 'expirada' AND ultima_actividad_en LIKE ?").get(`${hoy}%`).n,
    premios_entregados: db.prepare("SELECT COUNT(*) AS n FROM premios WHERE estado = 'entregado'").get().n,
    premios_disponibles: db.prepare("SELECT COUNT(*) AS n FROM premios WHERE estado = 'disponible'").get().n
  };

  res.json({ activas, totales });
});

module.exports = router;
