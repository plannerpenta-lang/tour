require('../src/index');

const BASE = 'http://localhost:3000/api';

async function api(metodo, ruta, cuerpo, pin) {
  const headers = { 'Content-Type': 'application/json' };
  if (pin) headers['x-staff-pin'] = pin;
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers,
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

  const otroUser = await api('POST', '/usuarios', { nombre: 'Beto Ruiz', telefono: '3109876543', consentimiento: true });
  const robo = await api('POST', '/sesiones', { usuario_id: otroUser.data.id, personaje_id: zorro.id });
  check('Rechaza personaje ya tomado', robo.status === 409, robo);

  console.log('--- 4. Linealidad del recorrido ---');
  const enRegistro = await api('GET', '/personajes?estado=en_tour&ubicacion=registro');
  check('Recién registrado aparece en Estación 1', enRegistro.data.some(p => p.nombre === 'Zorro'), null);
  const enE1antes = await api('GET', '/personajes?estado=en_tour&ubicacion=e2');
  check('NO aparece todavía en Estación 3', !enE1antes.data.some(p => p.nombre === 'Zorro'), null);

  const login = await api('POST', '/totem/login', { personaje_id: zorro.id, estacion_codigo: 'e1' });
  check('Tótem identifica al usuario', login.status === 200 && login.data.usuario === 'Ana Pérez', login);
  check('No expone el teléfono', login.data.telefono === undefined, login.data);
  const trasVisitas0 = await api('POST', '/totem/login', { personaje_id: zorro.id, estacion_codigo: 'e1' });
  check('Puntos iniciales = 0', trasVisitas0.data.puntos === 0, trasVisitas0.data);
  const enRegistroTrasE1 = await api('GET', '/personajes?estado=en_tour&ubicacion=registro');
  check('Ya no aparece en Estación 1 (avanzó)', !enRegistroTrasE1.data.some(p => p.nombre === 'Zorro'), null);
  const enE2trasE1 = await api('GET', '/personajes?estado=en_tour&ubicacion=e1');
  check('Ahora aparece en Estación 2', enE2trasE1.data.some(p => p.nombre === 'Zorro'), null);

  console.log('--- 5. Visitas a las 4 estaciones ---');
  for (const cod of ['e1', 'e2', 'e3', 'e4']) {
    const v = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: cod });
    check(`Visita ${cod} registrada`, v.status === 201, v);
  }
  const dup = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e1' });
  check('Rechaza estación repetida', dup.status === 409, dup);

  const trasVisitas = await api('POST', '/totem/login', { personaje_id: zorro.id, estacion_codigo: 'e4' });
  check('Puntos acumulados = 400', trasVisitas.data.puntos === 400, trasVisitas.data);

  console.log('--- 6. Finalización y premio (protegida con PIN) ---');
  const sinPin = await fetch(BASE + '/finalizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sesion_id: sesionId }) });
  check('Rechaza finalizar sin PIN', sinPin.status === 401, { status: sinPin.status });
  const pinMalo = await api('POST', '/finalizar', { sesion_id: sesionId }, '9999');
  check('Rechaza PIN incorrecto', pinMalo.status === 401, pinMalo);
  const fin = await api('POST', '/finalizar', { sesion_id: sesionId }, '1234');
  check('Premio asignado', fin.status === 201 || fin.status === 200, fin);
  check('Premio tiene código', typeof fin.data.premio === 'string' && fin.data.premio.startsWith('TOUR-'), fin.data);

  console.log('--- 7. Personaje liberado ---');
  const disp2 = await api('GET', '/personajes?estado=disponible');
  check('Zorro disponible de nuevo', disp2.data.some(p => p.nombre === 'Zorro'), null);

  const reuso = await api('POST', '/sesiones', { usuario_id: otroUser.data.id, personaje_id: zorro.id });
  check('Otro usuario puede tomarlo', reuso.status === 201, reuso);

  console.log('--- 8. Reuso del personaje tras liberación ---');

  console.log('--- 9. Liberación voluntaria ---');
  const libera = await api('POST', '/sesiones/liberar', { sesion_id: reuso.data.id });
  check('Sesión liberada', libera.status === 200 && libera.data.personaje_liberado, libera);
  const trasLiberar = await api('GET', '/personajes?estado=disponible');
  check('Personaje de vuelta al pool', trasLiberar.data.some(p => p.nombre === 'Zorro'), null);

  console.log('--- 10. Dashboard protegido + historial + export CSV + config ---');
  const ses3 = await api('POST', '/sesiones', { usuario_id: reg.data.id, personaje_id: zorro.id });
  await api('POST', '/totem/login', { personaje_id: zorro.id, estacion_codigo: 'e1' });
  const dashSinPin = await fetch(BASE + '/dashboard');
  check('Dashboard rechaza sin PIN', dashSinPin.status === 401, { status: dashSinPin.status });
  const dash = await api('GET', '/dashboard', undefined, '1234');
  check('Dashboard responde', dash.status === 200 && Array.isArray(dash.data.activas), dash);
  check('Muestra ubicación en tiempo real', dash.data.activas.some(a => a.ubicacion === 'e1'), dash.data.activas);
  await api('POST', '/sesiones/liberar', { sesion_id: ses3.data.id });
  check('Dashboard trae tiempos por estación', Array.isArray(dash.data.tiempos) && dash.data.tiempos.length === 6, dash.data.tiempos);
  check('Total de estaciones = 6', dash.data.total_estaciones === 6, dash.data.total_estaciones);
  const histSinPin = await fetch(BASE + '/historial');
  check('Historial rechaza sin PIN', histSinPin.status === 401, { status: histSinPin.status });
  const hist = await api('GET', '/historial', undefined, '1234');
  check('Historial trae registros completos', hist.status === 200 && hist.data.sesiones.length >= 2 && 'telefono' in hist.data.sesiones[0] && 'visitas' in hist.data.sesiones[0], null);
  check('Historial trae total de estaciones', hist.data.total_estaciones === 6, hist.data.total_estaciones);
  const estacionProhibida = await fetch(BASE + '/estaciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-staff-pin': '1234' },
    body: JSON.stringify({ nombre: 'Hack' })
  });
  check('No se pueden crear estaciones vía API', estacionProhibida.status === 404, { status: estacionProhibida.status });
  const csvSinPin = await fetch(BASE + '/exportar.csv');
  check('Export rechaza sin PIN', csvSinPin.status === 401, { status: csvSinPin.status });
  const csv = await fetch(BASE + '/exportar.csv?pin=1234');
  check('Export CSV responde', csv.status === 200 && (await csv.text()).includes('Ana Pérez'), null);
  const cfg = await api('PUT', '/config', { timeout_min: 20 }, '1234');
  check('Config actualizable', cfg.status === 200, cfg);
  const cfgVer = await api('GET', '/config', undefined, '1234');
  check('Config persistida', cfgVer.data.timeout_min === 20, cfgVer);

  console.log(fallos === 0 ? '\n✅ TODOS LOS TESTS PASARON' : `\n❌ ${fallos} TESTS FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
