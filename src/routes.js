const express = require('express');
const { db, ahora, obtenerConfig, guardarConfig } = require('./db');

const router = express.Router();

function emitir(io, evento, datos) {
  if (io) io.emit(evento, datos);
}

function requerirPin(req, res, next) {
  const esperado = obtenerConfig('staff_pin', '1234');
  const pin = req.get('x-staff-pin') || req.query.pin;
  if (!pin || pin !== esperado) {
    return res.status(401).json({ error: 'PIN de staff inválido' });
  }
  next();
}

// ---- Personajes ----

router.get('/personajes', (req, res) => {
  const { estado, ubicacion } = req.query;
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
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre completo es obligatorio' });
  if (!cedula || !String(cedula).trim()) return res.status(400).json({ error: 'La cédula es obligatoria' });
  if (!telefono || !String(telefono).trim()) return res.status(400).json({ error: 'El teléfono es obligatorio' });
  if (!email || !String(email).trim()) return res.status(400).json({ error: 'El correo electrónico es obligatorio' });
  if (!consentimiento) return res.status(400).json({ error: 'Se requiere el consentimiento de datos' });
  const r = db.prepare('INSERT INTO usuarios (nombre, cedula, telefono, email, consentimiento, creado_en) VALUES (?, ?, ?, ?, 1, ?)')
    .run(nombre.trim(), String(cedula).trim(), String(telefono).trim(), String(email).trim(), ahora());
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
    const r = db.prepare(`INSERT INTO sesiones (usuario_id, personaje_id, estado, ubicacion, iniciada_en, ultima_actividad_en)
      VALUES (?, ?, 'activa', 'registro', ?, ?)`).run(usuario_id, personaje_id, t, t);

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
    SELECT e.codigo, e.nombre, v.puntos, v.timestamp, v.detalle
    FROM visitas v JOIN estaciones e ON e.id = v.estacion_id
    WHERE v.sesion_id = ? ORDER BY e.orden
  `).all(fila.sesion_id);
  res.json(fila);
});

// ---- Menu Tótem 1 (almuerzos) ----

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
  const { sesion_id, estacion_codigo, puntos, plato_id } = req.body || {};
  const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
  if (!sesion) return res.status(404).json({ error: 'Sesión activa no encontrada' });

  const estacion = db.prepare('SELECT * FROM estaciones WHERE codigo = ?').get(estacion_codigo);
  if (!estacion) return res.status(404).json({ error: 'Estación no encontrada' });

  let puntosFinal = puntos ?? estacion.puntos;
  let detalle = null;

  if (estacion_codigo === 'e4' && req.body.respuesta1) {
    const r1 = String(req.body.respuesta1).trim();
    const r2 = req.body.respuesta2 ? String(req.body.respuesta2).trim() : '';
    if (r1 !== 'Sí' && r1 !== 'No') return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (r1 === 'Sí' && !r2) return res.status(400).json({ error: 'Responde la segunda pregunta' });
    db.exec('BEGIN');
    try {
      puntosFinal = estacion.puntos;
      detalle = r1 === 'Sí' ? `Mascotas: Sí | Motivo: ${r2}` : 'Mascotas: No';
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e5' && req.body.respuesta1) {
    const r1 = String(req.body.respuesta1).trim();
    const r2 = req.body.respuesta2 ? String(req.body.respuesta2).trim() : '';
    const r3 = req.body.respuesta3 ? String(req.body.respuesta3).trim() : '';
    if (r1 !== 'Sí' && r1 !== 'No') return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (r1 === 'Sí' && (!r2 || !r3)) return res.status(400).json({ error: 'Completa todas las preguntas' });
    db.exec('BEGIN');
    try {
      puntosFinal = estacion.puntos;
      detalle = r1 === 'Sí' ? `Vehículos: Sí | Tipo: ${r2} | Gasto: ${r3}` : 'Vehículos: No';
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e4' && req.body.combustible_id) {
    db.exec('BEGIN');
    try {
      const c = db.prepare('SELECT * FROM combustible WHERE id = ?').get(req.body.combustible_id);
      if (!c) throw Object.assign(new Error('Monto no encontrado'), { status: 404 });
      puntosFinal = c.puntos;
      detalle = c.etiqueta;
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, monto: c.etiqueta, puntos: puntosFinal });
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e2' && req.body.despensa_ids) {
    const ids = req.body.despensa_ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Selecciona al menos un producto' });
    db.exec('BEGIN');
    try {
      const placeholders = ids.map(() => '?').join(',');
      const items = db.prepare(`SELECT * FROM despensa WHERE id IN (${placeholders})`).all(...ids);
      if (items.length !== ids.length) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
      puntosFinal = items.reduce((s, p) => s + p.puntos, 0);
      detalle = items.map(p => p.nombre).join(', ');
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, productos: items.map(p => p.nombre), puntos: puntosFinal });
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e3' && (req.body.respuesta1 || req.body.respuesta2)) {
    const r1 = req.body.respuesta1;
    const r2 = req.body.respuesta2;
    if (!Array.isArray(r1) || r1.length === 0) return res.status(400).json({ error: 'Responde la primera pregunta' });
    if (!r2 || !String(r2).trim()) return res.status(400).json({ error: 'Responde la segunda pregunta' });
    db.exec('BEGIN');
    try {
      puntosFinal = estacion.puntos;
      detalle = `Compra: ${r1.join(', ')} | Gasto: ${r2}`;
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      return res.status(201).json({ id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal });
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e3' && req.body.productos_ids) {
    const ids = req.body.productos_ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Selecciona al menos un producto' });
    db.exec('BEGIN');
    try {
      const placeholders = ids.map(() => '?').join(',');
      const prods = db.prepare(`SELECT * FROM productos WHERE id IN (${placeholders})`).all(...ids);
      if (prods.length !== ids.length) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
      puntosFinal = prods.reduce((s, p) => s + p.puntos, 0);
      detalle = prods.map(p => p.nombre).join(', ');
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      const visita = { id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, productos: prods.map(p => p.nombre), puntos: puntosFinal };
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
      return res.status(201).json(visita);
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  if (estacion_codigo === 'e1' && plato_id) {
    db.exec('BEGIN');
    try {
      const plato = db.prepare('SELECT * FROM platos WHERE id = ?').get(plato_id);
      if (!plato) throw Object.assign(new Error('Plato no encontrado'), { status: 404 });
      puntosFinal = plato.puntos;
      detalle = plato.nombre;
      const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
        .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
      db.exec('COMMIT');
      const visita = { id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, plato: plato.nombre, puntos: puntosFinal };
      emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre, plato: plato.nombre });
      return res.status(201).json(visita);
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  try {
    const r = db.prepare('INSERT INTO visitas (sesion_id, estacion_id, puntos, timestamp, detalle) VALUES (?, ?, ?, ?, ?)')
      .run(sesion_id, estacion.id, puntosFinal, ahora(), detalle);
    db.prepare('UPDATE sesiones SET ultima_actividad_en = ?, ubicacion = ? WHERE id = ?').run(ahora(), estacion_codigo, sesion_id);
    const visita = { id: Number(r.lastInsertRowid), sesion_id, estacion: estacion.nombre, puntos: puntosFinal };
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'visita_registrada', sesion_id, estacion: estacion.nombre });
    res.status(201).json(visita);
  } catch (e) {
    res.status(409).json({ error: 'Esta estación ya fue registrada para esta sesión' });
  }
});

// ---- Liberación voluntaria ----

router.post('/sesiones/liberar', (req, res) => {
  const { sesion_id } = req.body || {};
  db.exec('BEGIN');
  try {
    const sesion = db.prepare("SELECT * FROM sesiones WHERE id = ? AND estado = 'activa'").get(sesion_id);
    if (!sesion) throw Object.assign(new Error('Sesión activa no encontrada'), { status: 404 });

    db.prepare("UPDATE sesiones SET estado = 'abandonada', completada_en = ? WHERE id = ?").run(ahora(), sesion_id);
    db.prepare("UPDATE personajes SET estado = 'disponible' WHERE id = ?").run(sesion.personaje_id);

    db.exec('COMMIT');
    emitir(req.app.get('io'), 'actualizacion', { tipo: 'sesion_liberada', sesion_id });
    res.json({ ok: true, personaje_liberado: true });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Finalización y premio (protegida con PIN) ----

router.post('/finalizar', requerirPin, (req, res) => {
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
      minutos_desde_inicio: Math.round((fila.min_promedio || 0) * 10) / 10
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

  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
  if (staff_pin !== undefined && String(staff_pin).length < 4) {
    return res.status(400).json({ error: 'El PIN debe tener al menos 4 caracteres' });
  }
  if (timeout_min !== undefined && (Number(timeout_min) < 1 || Number(timeout_min) > 240)) {
    return res.status(400).json({ error: 'El timeout debe estar entre 1 y 240 minutos' });
  }
  if (staff_pin !== undefined) guardarConfig('staff_pin', String(staff_pin));
  if (timeout_min !== undefined) guardarConfig('timeout_min', Number(timeout_min));
  emitir(req.app.get('io'), 'actualizacion', { tipo: 'config_actualizada' });
  res.json({ ok: true });
});

module.exports = router;
