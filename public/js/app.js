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

const IDLE_MS = 120000;
const WARN_MS = 15000;
let idleTimer = null;
let warnTimer = null;
let warnEl = null;

function crearWarn() {
  if (warnEl) return warnEl;
  warnEl = document.createElement('div');
  warnEl.id = 'idle-warn';
  warnEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:100;padding:24px;';
  warnEl.innerHTML = '<div style="background:var(--card);padding:32px;border-radius:20px;text-align:center;max-width:420px;width:100%"><h2 style="font-family:Nunito,sans-serif;margin-bottom:12px;">¿Sigues ahí?</h2><p style="color:var(--muted);margin-bottom:20px;">Toca para continuar — reinicio en <b id="idle-count">15</b>s</p><button class="boton" onclick="reiniciarIdle()">Continuar</button></div>';
  warnEl.addEventListener('click', (e) => { if (e.target === warnEl) reiniciarIdle(); });
  document.body.appendChild(warnEl);
  return warnEl;
}

function ocultarWarn() {
  if (warnEl) warnEl.style.display = 'none';
  clearTimeout(warnTimer);
}

function mostrarWarn() {
  const el = crearWarn();
  let c = 15;
  el.style.display = 'flex';
  const t = document.getElementById('idle-count');
  if (t) t.textContent = c;
  const tick = () => {
    c--;
    const tt = document.getElementById('idle-count');
    if (tt) tt.textContent = c;
    if (c <= 0) { el.style.display = 'none'; location.reload(); }
    else warnTimer = setTimeout(tick, 1000);
  };
  warnTimer = setTimeout(tick, 1000);
}

function reiniciarIdle() {
  ocultarWarn();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const a = document.activeElement;
    const escribiendo = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    if (escribiendo) { reiniciarIdle(); return; }
    mostrarWarn();
  }, IDLE_MS - WARN_MS);
}
['click', 'touchstart', 'keydown', 'input', 'scroll'].forEach(ev => document.addEventListener(ev, reiniciarIdle, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reiniciarIdle(); });
reiniciarIdle();

window.addEventListener('beforeunload', () => {
  try {
    if (typeof sesionActual !== 'undefined' && sesionActual) sessionStorage.setItem('tour_sesion', JSON.stringify(sesionActual));
    const activa = document.querySelector('.screen.activa');
    if (activa) sessionStorage.setItem('tour_pantalla', activa.id);
  } catch (_) {}
});
