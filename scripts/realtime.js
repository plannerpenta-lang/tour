require('../src/index');
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000/api';
const api = (m, ruta, cuerpo) => fetch(BASE + ruta, {
  method: m, headers: { 'Content-Type': 'application/json' },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined
}).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

(async () => {
  await new Promise(r => setTimeout(r, 500));
  const eventos = [];
  const socket = io('http://localhost:3000');
  socket.on('actualizacion', msg => eventos.push(msg));
  await new Promise(r => socket.on('connect', r));

  const u = await api('POST', '/usuarios', { nombre: 'RT Test', cedula: '1', telefono: '1', email: 'rt@rt.com', consentimiento: true });
  const zorro = (await api('GET', '/personajes?estado=disponible')).data[0];
  const s = await api('POST', '/sesiones', { usuario_id: u.data.id, personaje_id: zorro.id });
  await new Promise(r => setTimeout(r, 300));
  const v = await api('POST', '/visitas', { sesion_id: s.data.id, estacion_codigo: 'e1', despensa_ids: [(await api('GET', '/despensa')).data[0].id] });
  await new Promise(r => setTimeout(r, 300));

  const tipos = eventos.map(e => e.tipo);
  const okInicio = tipos.includes('sesion_iniciada');
  const okVisita = tipos.includes('visita_registrada');
  console.log('eventos recibidos:', tipos.join(', '));
  console.log(okInicio && okVisita && v.status === 201 ? 'REALTIME OK' : 'REALTIME FALLO');
  socket.disconnect();
  process.exit(okInicio && okVisita && v.status === 201 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
