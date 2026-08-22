const API = '/api';

async function _fetchApi(metodo, ruta, cuerpo, pin) {
  const headers = { 'Content-Type': 'application/json' };
  if (pin) headers['x-staff-pin'] = pin;
  return fetch(API + ruta, {
    method: metodo,
    headers,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  });
}

async function api(metodo, ruta, cuerpo, pin) {
  let r;
  try {
    r = await _fetchApi(metodo, ruta, cuerpo, pin);
  } catch {
    await new Promise(res => setTimeout(res, 800));
    try {
      r = await _fetchApi(metodo, ruta, cuerpo, pin);
    } catch {
      throw Object.assign(new Error('Sin conexión con el servidor'), { status: 0 });
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Error de conexión'), { status: r.status });
  return data;
}

function mostrarPantalla(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('activa'));
  document.getElementById(id).classList.add('activa');
}

let toastTimer = null;
function toast(mensaje, color) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  if (color) t.style.background = color;
  t.textContent = mensaje;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4000);
}

async function liberarSesion(sesionId, mensaje) {
  if (!confirm(mensaje || '¿Liberar este personaje para otros usuarios?')) return;
  try {
    await api('POST', '/sesiones/liberar', { sesion_id: sesionId });
    location.reload();
  } catch (err) { toast(err.message); }
}

const socket = io();
socket.on('connect', () => {
  document.querySelectorAll('.estado-conexion').forEach(e => {
    e.textContent = 'En línea';
    e.className = 'estado-conexion online';
  });
});
socket.on('disconnect', () => {
  document.querySelectorAll('.estado-conexion').forEach(e => {
    e.textContent = 'Sin conexión';
    e.className = 'estado-conexion offline';
  });
});

const IDLE_MS = 60000;
let idleTimer = null;
function reiniciarIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => location.reload(), IDLE_MS);
}
['click', 'touchstart'].forEach(ev => document.addEventListener(ev, reiniciarIdle, { passive: true }));
reiniciarIdle();
