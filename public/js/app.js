const API = '/api';

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Error de conexión'), { status: r.status });
  return data;
}

function mostrarPantalla(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('activa'));
  document.getElementById(id).classList.add('activa');
}

let toastTimer = null;
function toast(mensaje) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = mensaje;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4000);
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
