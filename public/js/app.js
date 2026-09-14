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
  const el = document.getElementById(id);
  if (!el) { console.error('Pantalla no encontrada:', id); return; }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('activa'));
  el.classList.add('activa');
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
  if (!Number.isInteger(sesionId) || sesionId <= 0) { toast('Sesión no válida'); return; }
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
  window.dispatchEvent(new Event('reconnect'));
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
  idleTimer = setTimeout(() => {
    const activo = document.activeElement;
    const escribiendo = activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.isContentEditable);
    if (escribiendo) { reiniciarIdle(); return; }
    location.reload();
  }, IDLE_MS);
}
['click', 'touchstart', 'keydown', 'input', 'scroll'].forEach(ev => document.addEventListener(ev, reiniciarIdle, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reiniciarIdle(); });
reiniciarIdle();
