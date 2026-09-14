const express = require('express');
const { db, ahora, obtenerConfig, guardarConfig } = require('./db');
const crypto = require('node:crypto');

const router = express.Router();

function emitir(io, evento, datos) {
  if (io) io.emit(evento, datos);
}

function sanitize(str, max = 200) {
  return String(str).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])).slice(0, max);
}

function requerirPin(req, res, next) {
  const esperado = obtenerConfig('staff_pin', '1234');
  const pin = req.get('x-staff-pin');
  if (!pin || pin.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(esperado))) {
    return res.status(401).json({ error: 'PIN de staff inválido' });
  }
  next();
}

function validarUbicacion(sesion, estacion) {
  if (estacion.tipo !== 'estacion') return true;
  const estaciones = db.prepare("SELECT codigo, orden FROM estaciones WHERE tipo = 'estacion' ORDER BY orden").all();
  const idx = estaciones.findIndex(e => e.codigo === estacion.codigo);
  if (idx === -1) return false;
  const esperado = idx === 0 ? 'registro' : estaciones[idx - 1].codigo;
  return sesion.ubicacion === esperado;
}

// ---- Personajes ----

router.get('/personajes', (req, res) => {
  const { estado, ubicacion } = req.query;
  const permitidosEstado = ['disponible', 'en_tour'];
  const permitidosUbicacion = ['registro', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'final'];
  if (estado && !permitidosEstado.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  if (ubicacion && !permitidosUbicacion.includes(ubicacion)) return res.status(400).json({ error: 'Ubicación no válida' });
  if (estado === 'en_tour' && ubicacion) {
    const filas = db.prepare(`
      SELECT p.* FROM personajes p
      JOIN sesiones s ON s.personaje_id = p.id AND s.estado = 'activa'
      WHERE p.estado = 'en_tour' AND s.ubicacion = ?
      ORDER BY p.id
    `).all(ubicacion);
    return res.json(filas);
  }
  const filas = estado
    ? db.prepare('SELECT * FROM personajes WHERE estado = ? ORDER BY id').all(estado)
    : db.prepare('SELECT * FROM personajes ORDER BY id').all();
  res.json(filas);
});

// ---- Registro de usuario ----

router.post('/usuarios', (req, res) => {
  const { nombre, cedula, telefono, email, consentimiento } = req.body || {};
  if (!nombre || typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 80) return res.status(400).json({ error: 'El nombre completo es obligatorio (max 80)' });
  if (!cedula || typeof cedula !== 'string' || !/^[0-9]{6,20}$/.test(String(cedula).trim())) return res.status(400).json({ error: 'La cédula debe ser numérica (6-20 dígitos)' });
  if (!telefono || typeof telefono !== 'string' || !/^[0-9+\s-]{7,20}$/.test(String(telefono).trim())) return res.status(400).json({ error: 'El teléfono no es válido' });
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()) || String(email).trim().length > 80) return res.status(400).json({ error: 'El correo electrónico no es válido' });
  if (consentimiento !== true) return res.status(400).json({ error: 'Se requiere el consentimiento de datos' });
  if (/[<>]/.test(nombre) || /[<>]/.test(email)) return res.status(400).json({ error: 'Caracteres no permitidos' });
  const r = db.prepare('INSERT INTO usuarios (nombre, cedula, telefono, email, consentimiento, creado_en) VALUES (?, ?, ?, ?, 1, ?)')
    .run(sanitize(nombre.trim(), 80), String(cedula).trim().slice(0, 20), String(telefono).trim().slice(0, 20), String(email).trim().slice(0, 80), ahora());
  res.status(201).json({ id: Number(r.lastInsertRowid), nombre: sanitize(nombre.trim(), 80) });
});

// ---- Sesiones ----

router.post('/sesiones', (req, res) => {
  const { usuario_id, personaje_id } = req.body || {};
  if (!Number.isInteger(usuario_id) || usuario_id <= 0 || !Number.isInteger(personaje_id) || personaje_id <= 0) return res.status(400).json({ error: 'Datos de sesión no válidos' });
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario_id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  db.exec('BEGIN IMMEDIATE');
  try {
    const personaje = db.prepare("SELECT * FROM personajes WHERE id = ?").get(personaje_id);
    if (!personaje) throw Object.assign(new Error('Personaje no encontrado'), { status: 404 });
    if (personaje.estado !== 'disponible') throw Object.assign(new Error('Ese personaje acaba de ser tomado por otro usuario'), { status: 409 });

    db.prepare("UPDATE personajes SET estado = 'en_tour' WHERE id = ?").run(personaje_id);
    const t = ahora();
    const r = db.prepare(`INSERT INTO sesiones (usuario_id, personaje_id, estado, ubicacion, iniciada_en, ultima_actividad_en)
      VALUES (?, ?, 'activa', 'registro', ?, ?)`).run(usuario_id, personaje_id, t, t);

    db.exec('COMMIT');
    const sesion = { id: Number(r.lastInsertRowid), usuario_id, personaje_id };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'sesion_iniciada', sesion, personaje_id });
    res.status(201).json(sesion);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// El totem identifica al usuario por su personaje
router.post('/totem/login', (req, res) => {
  const { personaje_id } = req.body || {};
  if (!Number.isInteger(personaje_id) || personaje_id <= 0) return res.status(400).json({ error: 'Personaje no válido' });
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
    SELECT e.codigo, e.nombre, v.puntos, v.timestamp, v.detalle
    FROM visitas v JOIN estaciones e ON e.id = v.estacion_id
    WHERE v.sesion_id = ? ORDER BY e.orden
  `).all(fila.sesion_id);
  res.json(fila);
});

// ---- Catálogos ----

router.get('/menu', (req, res) => {
  res.json(db.prepare('SELECT * FROM platos ORDER BY id').all());
});

router.get('/productos', (req, res) => {
  const { estacion } = req.query;
  if (estacion) return res.json(db.prepare('SELECT * FROM productos WHERE estacion = ? ORDER BY id').all(estacion));
  res.json(db.prepare('SELECT * FROM productos ORDER BY id').all());
});

router.get('/combustible', (req, res) => {
  res.json(db.prepare('SELECT * FROM combustible ORDER BY monto').all());
});

router.get('/despensa', (req, res) => {
  res.json(db.prepare('SELECT * FROM despensa ORDER BY id').all());
});

// ---- Visitas a estaciones ----

router.post('/visitas', (req, res) => {
  const { sesion_id, estacion_codigo } = req.body || {};
  if (!Number.isInteger(sesion_id) || sesion_id <= 0 || typeof estacion_codigo !== 'string' || !estacion_codigo) return res.status(400).json({ error: 'Datos no válidos' });
  const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
  if (!sesion) return res.status(404).json({ error: 'Sesión activa no encontrada' });

  const estacion = db.prepare('SELECT * FROM estaciones WHERE codigo = ?').get(estacion_codigo);
  if (!estacion) return res.status(404).json({ error: 'Estación no encontrada' });
  if (!validarUbicacion(sesion, estacion)) return res.status(409).json({ error: 'Debes completar la estación anterior primero' });

  let puntosFinal = estacion.puntos;
  let detalle = null;

  if (estacion_codigo === 'e5') {
    const r1 = req.body.respuesta1 ? String(req.body.respuesta1).trim() : '';
    const r2 = req.body.respuesta2 ? String(req.body.respuesta2).trim() : '';
    const r3 = req.body.respuesta3 ? String(req.body.respuesta3).trim() : '';
    if (!r1) return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (!r2) return res.status(400).json({ error: 'Responde la segunda pregunta' });
    if (!r3) return res.status(400).json({ error: 'Elige qué quieres comer hoy' });
    db.exec('BEGIN IMMEDIATE');
    try {
      detalle = `Frecuencia: ${sanitize(r1)} | Gasto: ${sanitize(r2)} | Antojo: ${sanitize(r3)}`;
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (estacion_codigo === 'e3') {
    const r1 = String(req.body.respuesta1 || '').trim();
    const r2 = req.body.respuesta2 ? String(req.body.respuesta2).trim() : '';
    if (r1 !== 'Sí' && r1 !== 'No') return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (r1 === 'Sí' && !r2) return res.status(400).json({ error: 'Responde la segunda pregunta' });
    db.exec('BEGIN IMMEDIATE');
    try {
      detalle = r1 === 'Sí' ? `Mascotas: Sí | Motivo: ${sanitize(r2)}` : 'Mascotas: No';
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (estacion_codigo === 'e4') {
    const r1 = String(req.body.respuesta1 || '').trim();
    const r2 = req.body.respuesta2 ? String(req.body.respuesta2).trim() : '';
    const r3 = req.body.respuesta3 ? String(req.body.respuesta3).trim() : '';
    if (r1 !== 'Sí' && r1 !== 'No') return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (r1 === 'Sí' && (!r2 || !r3)) return res.status(400).json({ error: 'Completa todas las preguntas' });
    db.exec('BEGIN IMMEDIATE');
    try {
      detalle = r1 === 'Sí' ? `Vehículos: Sí | Tipo: ${sanitize(r2)} | Gasto: ${sanitize(r3)}` : 'Vehículos: No';
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (estacion_codigo === 'e1') {
    const ids = req.body.despensa_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) return res.status(400).json({ error: 'Selecciona al menos un producto' });
    if (!ids.every(id => Number.isInteger(id) && id > 0)) return res.status(400).json({ error: 'Productos no válidos' });
    const únicos = [...new Set(ids)];
    if (únicos.length !== ids.length) return res.status(400).json({ error: 'Productos duplicados' });
    db.exec('BEGIN IMMEDIATE');
    try {
      const placeholders = únicos.map(() => '?').join(',');
      const items = db.prepare(`SELECT * FROM despensa WHERE id IN (${placeholders})`).all(...únicos);
      if (items.length !== únicos.length) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
      puntosFinal = items.reduce((s, p) => s + p.puntos, 0);
      detalle = items.map(p => sanitize(p.nombre, 50)).join(', ');
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, productos: items.map(p => p.nombre), puntos: puntosFinal });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (estacion_codigo === 'e2') {
    const r1 = req.body.respuesta1;
    const r2 = req.body.respuesta2;
    if (!Array.isArray(r1) || r1.length === 0 || r1.length > 10) return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (r1.some(v => typeof v !== 'string' || v.trim().length === 0 || v.trim().length > 50)) return res.status(400).json({ error: 'Opciones no válidas' });
    if (!r2 || typeof r2 !== 'string' || !r2.trim() || r2.trim().length > 50) return res.status(400).json({ error: 'Responde la segunda pregunta' });
    db.exec('BEGIN IMMEDIATE');
    try {
      detalle = `Compra: ${r1.map(v => sanitize(v.trim(), 50)).join(', ')} | Gasto: ${sanitize(r2.trim(), 50)}`;
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // Fallback solo para estaciones no específicas (futuras) — requiere estar en orden y sin payload esperado
  const estacionesConocidas = ['e1', 'e2', 'e3', 'e4', 'e5'];
  if (estacionesConocidas.includes(estacion_codigo)) return res.status(400).json({ error: 'Datos incompletos para esta estación' });

  db.exec('BEGIN IMMEDIATE');
  try {
    const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
      .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
    db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
    db.exec('COMMIT');
    const visita = { id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
    res.status(201).json(visita);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Liberación voluntaria ----

router.post('/sesiones/liberar', (req, res) => {
  const { sesion_id } = req.body || {};
  if (!Number.isInteger(sesion_id) || sesion_id <= 0) return res.status(400).json({ error: 'Sesión no válida' });
  db.exec('BEGIN IMMEDIATE');
  try {
    const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
    if (!sesion) throw Object.assign(new Error('Sesión activa no encontrada'), { status: 404 });

    db.prepare("UPDATE sesiones SET estado = 'abandonada', completada_en = ? WHERE id = ?").run(ahora(), sesion_id);
    db.prepare("UPDATE personajes SET estado = 'disponible' WHERE id = ?").run(sesion.personaje_id);

    db.exec('COMMIT');
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'sesion_liberada', sesion_id });
    res.json({ ok: true, personaje_liberado: true });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Finalización y premio (protegida con PIN) ----

router.post('/finalizar', requerirPin, (req, res) => {
  const { sesion_id } = req.body || {};
  if (!Number.isInteger(sesion_id) || sesion_id <= 0) return res.status(400).json({ error: 'Sesión no válida' });
  db.exec('BEGIN IMMEDIATE');
  try {
    const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
    if (!sesion) throw Object.assign(new Error('Sesión activa no encontrada'), { status: 404 });

    const premio = db.prepare("SELECT * FROM premios WHERE estado = 'disponible' ORDER BY id LIMIT 1").get();

    let valorPremio = null;
    if (premio) {
      valorPremio = premio.valor;
      const upd = db.prepare("UPDATE premios SET estado = 'entregado', sesion_id = ? WHERE id = ? AND estado = 'disponible'").run(sesion_id, premio.id);
      if (upd.changes === 0) throw Object.assign(new Error('Premio ya tomado, reintenta'), { status: 409 });
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
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Estaciones y dashboard ----

router.get('/estaciones', (req, res) => {
  res.json(db.prepare('SELECT * FROM estaciones ORDER BY orden').all());
});

// ---- Dashboard (protegido con PIN) ----

router.get('/dashboard', requerirPin, (req, res) => {
  const activas = db.prepare(`
    SELECT s.id AS sesion_id, u.nombre AS usuario, p.avatar, p.nombre AS personaje,
           s.ubicacion, s.iniciada_en, s.ultima_actividad_en,
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
    tours_abandonados_hoy: db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE estado IN ('expirada','abandonada') AND ultima_actividad_en LIKE ?").get(`${hoy}%`).n,
    premios_entregados: db.prepare("SELECT COUNT(*) AS n FROM premios WHERE estado = 'entregado'").get().n,
    premios_disponibles: db.prepare("SELECT COUNT(*) AS n FROM premios WHERE estado = 'disponible'").get().n
  };

  const estaciones = db.prepare("SELECT * FROM estaciones WHERE tipo = 'estacion' ORDER BY orden").all();
  const tiempos = estaciones.map(e => {
    const fila = db.prepare(`
      SELECT AVG((julianday(v2.timestamp) - julianday(s.iniciada_en)) * 1440) AS min_promedio
      FROM visitas v
      JOIN sesiones s ON s.id = v.sesion_id
      JOIN visitas v2 ON v2.sesion_id = v.sesion_id AND v2.estacion_id = v.estacion_id
      WHERE v.estacion_id = ?
    `).get(e.id);
    return {
      estacion: e.nombre,
      codigo: e.codigo,
      visitas: db.prepare('SELECT COUNT(*) AS n FROM visitas WHERE estacion_id = ?').get(e.id).n,
      minutos_desde_inicio: Math.round(((fila?.min_promedio) || 0) * 10) / 10
    };
  });

  const totalEstaciones = db.prepare("SELECT COUNT(*) AS n FROM estaciones WHERE tipo = 'estacion'").get().n;

  res.json({ activas, totales, tiempos, total_estaciones: totalEstaciones });
});

// ---- Historial completo (protegido con PIN) ----

router.get('/historial', requerirPin, (req, res) => {
  const filas = db.prepare(`
    SELECT s.id AS sesion_id, u.nombre, u.cedula, u.telefono, u.email,
           p.avatar, p.nombre AS personaje,
           s.estado, s.ubicacion, s.iniciada_en, COALESCE(s.completada_en, '') AS completada_en,
           COALESCE((SELECT SUM(puntos) FROM visitas WHERE sesion_id = s.id), 0) AS puntos,
           COALESCE(s.premio, '') AS premio
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    JOIN personajes p ON p.id = s.personaje_id
    ORDER BY s.iniciada_en DESC
  `).all();

  const visitasStmt = db.prepare(`
    SELECT e.nombre AS estacion, e.codigo, v.puntos, v.timestamp, v.detalle
    FROM visitas v JOIN estaciones e ON e.id = v.estacion_id
    WHERE v.sesion_id = ? ORDER BY e.orden
  `);
  for (const f of filas) f.visitas = visitasStmt.all(f.sesion_id);
  const totalEstaciones = db.prepare("SELECT COUNT(*) AS n FROM estaciones WHERE tipo = 'estacion'").get().n;
  res.json({ sesiones: filas, total_estaciones: totalEstaciones });
});

// ---- Exportar CSV (protegido con PIN) ----

router.get('/exportar.csv', requerirPin, (req, res) => {
  const filas = db.prepare(`
    SELECT s.id, u.nombre, u.cedula, u.telefono, u.email, p.nombre AS personaje, s.estado,
           s.iniciada_en, COALESCE(s.completada_en, '') AS completada_en,
           COALESCE((SELECT SUM(puntos) FROM visitas WHERE sesion_id = s.id), 0) AS puntos,
           COALESCE(s.premio, '') AS premio
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    JOIN personajes p ON p.id = s.personaje_id
    ORDER BY s.id
  `).all();

  const esc = v => {
    let s = String(v ?? '');
    if (/^[=+\-@|]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lineas = ['id,nombre,cedula,telefono,email,personaje,estado,iniciada_en,completada_en,puntos,premio'];
  for (const f of filas) lineas.push([f.id, f.nombre, f.cedula, f.telefono, f.email, f.personaje, f.estado, f.iniciada_en, f.completada_en, f.puntos, f.premio].map(esc).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="tour-export.csv"');
  res.send('\ufeff' + lineas.join('\r\n'));
});

// ---- Configuración en vivo (protegida con PIN) ----

router.get('/config', requerirPin, (req, res) => {
  res.json({
    staff_pin: obtenerConfig('staff_pin', '1234'),
    timeout_min: Number(obtenerConfig('timeout_min', '15'))
  });
});

router.put('/config', requerirPin, (req, res) => {
  const { staff_pin, timeout_min } = req.body || {};
  if (staff_pin !== undefined) {
    const s = String(staff_pin);
    if (s.length < 4 || s.length > 32 || !/^[0-9A-Za-z]+$/.test(s)) return res.status(400).json({ error: 'El PIN debe ser alfanumérico de 4-32 caracteres' });
  }
  if (timeout_min !== undefined) {
    const n = Number(timeout_min);
    if (!Number.isInteger(n) || n < 1 || n > 240) return res.status(400).json({ error: 'El timeout debe ser entero entre 1 y 240 minutos' });
  }
  if (staff_pin !== undefined) guardarConfig('staff_pin', String(staff_pin));
  if (timeout_min !== undefined) guardarConfig('timeout_min', Number(timeout_min));
  emitir(req.app.get('io'), 'actualizacion', { tipo: 'config_actualizada' });
  res.json({ ok: true });
});

module.exports = router;
