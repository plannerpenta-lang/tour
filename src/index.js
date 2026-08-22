const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { db, ahora } = require('./db');
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
const TIMEOUT_MIN = Number(process.env.SESSION_TIMEOUT_MIN || 15);

function expirarSesiones() {
  const limite = new Date(Date.now() - TIMEOUT_MIN * 60 * 1000).toISOString();
  const vencidas = db.prepare(`
    SELECT s.id, s.personaje_id FROM sesiones s
    WHERE s.estado = 'activa' AND s.ultima_actividad_en < ?
  `).all(limite);

  for (const s of vencidas) {
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE sesiones SET estado = 'expirada' WHERE id = ?").run(s.id);
      db.prepare("UPDATE personajes SET estado = 'disponible' WHERE id = ?").run(s.personaje_id);
      db.exec('COMMIT');
      io.emit('actualizacion', { tipo: 'sesion_expirada', sesion_id: s.id });
      console.log(`[timeout] Sesión ${s.id} expirada`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('[timeout]', e.message);
    }
  }
}
setInterval(expirarSesiones, 60 * 1000);

io.on('connection', (socket) => {
  socket.emit('actualizacion', { tipo: 'conectado' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor del tour en http://localhost:${PORT}`);
  console.log(`Timeout de sesión: ${TIMEOUT_MIN} min`);
});
