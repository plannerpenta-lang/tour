const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { db, ahora, obtenerConfig } = require('./db');
const routes = require('./routes');

require('./seed');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => { req.app.set('io', io); next(); });
app.use('/api', routes);
app.get('/health', (req, res) => res.json({ ok: true }));

// ---- Timeout de sesiones ----

function expirarSesiones() {
  const timeoutMin = Number(obtenerConfig('timeout_min', '15'));
  const limite = new Date(Date.now() - timeoutMin * 60 * 1000).toISOString();
  const vencidas = db.prepare(`
    SELECT s.id, s.personaje_id FROM sesiones s
    WHERE s.estado = 'activa' AND s.ultima_actividad_en < ?
  `).all(limite);

  for (const s of vencidas) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE sesiones SET estado = 'expirada' WHERE id = ?").run(s.id);
      db.prepare("UPDATE personajes SET estado = 'disponible' WHERE id = ?").run(s.personaje_id);
      db.exec('COMMIT');
      io.emit('actualizacion', { tipo: 'sesion_expirada', sesion_id: s.id });
      console.log(`[timeout] Sesión ${s.id} expirada`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      console.error('[timeout]', e.message);
    }
  }
}
setInterval(expirarSesiones, 60 * 1000);
expirarSesiones();

io.on('connection', (socket) => {
  socket.emit('actualizacion', { tipo: 'conectado' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor del tour en http://localhost:${PORT}`);
  console.log(`Timeout de sesión: ${obtenerConfig('timeout_min', '15')} min (configurable desde el dashboard)`);
});
