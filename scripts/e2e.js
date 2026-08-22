require('../src/index');

const BASE = 'http://localhost:3000/api';

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const data = await r.json();
  return { status: r.status, data };
}

let fallos = 0;
function check(nombre, cond, detalle) {
  if (cond) console.log(`  OK   ${nombre}`);
  else { fallos++; console.log(`  FALLO ${nombre} -> ${JSON.stringify(detalle)}`); }
}

(async () => {
  await new Promise(r => setTimeout(r, 500));

  console.log('--- 1. Personajes disponibles ---');
  const disp = await api('GET', '/personajes?estado=disponible');
  check('Hay personajes disponibles', disp.status === 200 && disp.data.length === 12, disp);
  const zorro = disp.data.find(p => p.nombre === 'Zorro');

  console.log('--- 2. Registro de usuario ---');
  const reg = await api('POST', '/usuarios', { nombre: 'Ana Pérez', telefono: '3001234567', consentimiento: true });
  check('Usuario creado', reg.status === 201 && reg.data.id > 0, reg);

  const sinConsent = await api('POST', '/usuarios', { nombre: 'X', consentimiento: false });
  check('Rechaza sin consentimiento', sinConsent.status === 400, sinConsent);

  console.log('--- 3. Inicio de sesión con personaje (bloqueo) ---');
  const ses = await api('POST', '/sesiones', { usuario_id: reg.data.id, personaje_id: zorro.id });
  check('Sesión creada', ses.status === 201 && (ses.data.id > 0 || ses.data.sesion_id > 0), ses);
  const sesionId = ses.data.sesion_id ?? ses.data.id;

  const otroUser = await api('POST', '/usuarios', { nombre: 'Beto Ruiz', consentimiento: true });
  const robo = await api('POST', '/sesiones', { usuario_id: otroUser.data.id, personaje_id: zorro.id });
  check('Rechaza personaje ya tomado', robo.status === 409, robo);

  console.log('--- 4. Login en estación intermedia ---');
  const login = await api('POST', '/totem/login', { personaje_id: zorro.id });
  check('Tótem identifica al usuario', login.status === 200 && login.data.usuario === 'Ana Pérez', login);

  console.log('--- 5. Visitas a las 4 estaciones ---');
  for (const cod of ['e1', 'e2', 'e3', 'e4']) {
    const v = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: cod });
    check(`Visita ${cod} registrada`, v.status === 201, v);
  }
  const dup = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e1' });
  check('Rechaza estación repetida', dup.status === 409, dup);

  const trasVisitas = await api('POST', '/totem/login', { personaje_id: zorro.id });
  check('Puntos acumulados = 400', trasVisitas.data.puntos === 400, trasVisitas.data);

  console.log('--- 6. Finalización y premio ---');
  const fin = await api('POST', '/finalizar', { sesion_id: sesionId });
  check('Premio asignado', fin.status === 201 || fin.status === 200, fin);
  check('Premio tiene código', typeof fin.data.premio === 'string' && fin.data.premio.startsWith('TOUR-'), fin.data);

  console.log('--- 7. Personaje liberado ---');
  const disp2 = await api('GET', '/personajes?estado=disponible');
  check('Zorro disponible de nuevo', disp2.data.some(p => p.nombre === 'Zorro'), null);

  const reuso = await api('POST', '/sesiones', { usuario_id: otroUser.data.id, personaje_id: zorro.id });
  check('Otro usuario puede tomarlo', reuso.status === 201, reuso);

  console.log('--- 8. Dashboard ---');
  const dash = await api('GET', '/dashboard');
  check('Dashboard responde', dash.status === 200 && Array.isArray(dash.data.activas), dash);

  console.log(fallos === 0 ? '\n✅ TODOS LOS TESTS PASARON' : `\n❌ ${fallos} TESTS FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
