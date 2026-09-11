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
  const reg = await api('POST', '/usuarios', { nombre: 'Ana Pérez', cedula: '11001100', telefono: '3001234567', email: 'ana@example.com', consentimiento: true });
  check('Usuario creado', reg.status === 201 && reg.data.id > 0, reg);

  const sinConsent = await api('POST', '/usuarios', { nombre: 'X', cedula: '1', telefono: '1', email: 'x@x.com', consentimiento: false });
  check('Rechaza sin consentimiento', sinConsent.status === 400, sinConsent);

  const sinCedula = await api('POST', '/usuarios', { nombre: 'Y', telefono: '3000000000', email: 'y@y.com', consentimiento: true });
  check('Rechaza sin cédula', sinCedula.status === 400, sinCedula);

  console.log('--- 3. Inicio de sesión con personaje (bloqueo) ---');
  const ses = await api('POST', '/sesiones', { usuario_id: reg.data.id, personaje_id: zorro.id });
  check('Sesión creada', ses.status === 201 && (ses.data.id > 0 || ses.data.sesion_id > 0), ses);
  const sesionId = ses.data.sesion_id ?? ses.data.id;

  const otroUser = await api('POST', '/usuarios', { nombre: 'Beto Ruiz', cedula: '22002200', telefono: '3109876543', email: 'beto@example.com', consentimiento: true });
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
  const trasVisitas0 = await api('POST', '/totem/login', { personaje_id: zorro.id });
  check('Puntos iniciales = 0', trasVisitas0.data.puntos === 0, trasVisitas0.data);
  check('Ubicación no avanza solo al identificarse', (await api('GET', '/personajes?estado=en_tour&ubicacion=registro')).data.some(p => p.nombre === 'Zorro'), null);
  console.log('--- 4b. Despensa Tótem 1 ---');
  const desp = await api('GET', '/despensa');
  check('Productos de alacena cargados', desp.data.length === 11, desp);
  const enRegistroTrasLogin = await api('GET', '/personajes?estado=en_tour&ubicacion=registro');
  check('Sigue en registro si no confirma (recarga lo muestra de nuevo)', enRegistroTrasLogin.data.some(p => p.nombre === 'Zorro'), null);

  console.log('--- 5. Visitas (supermercado, farmacia, veterinaria, gasolina, restaurantes) ---');
  const v1 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e1', despensa_ids: [desp.data[0].id, desp.data[1].id, desp.data[2].id] });
  check('Selección de alacena registrada en Tótem 1', v1.status === 201 && v1.data.productos.length === 3, v1);
  const enRegistroTrasVisita = await api('GET', '/personajes?estado=en_tour&ubicacion=registro');
  check('Ya no aparece en Tótem 1 tras confirmar', !enRegistroTrasVisita.data.some(p => p.nombre === 'Zorro'), null);
  const enE2trasVisita = await api('GET', '/personajes?estado=en_tour&ubicacion=e1');
  check('Ahora aparece en Tótem 2', enE2trasVisita.data.some(p => p.nombre === 'Zorro'), null);
  const v2 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e2', respuesta1: ['Botiquín del hogar', 'Cuidado personal'], respuesta2: '₡20.001 – ₡30.000' });
  check('Encuesta farmacia registrada', v2.status === 201, v2);
  const v2incompleta = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e2', respuesta1: ['Botiquín del hogar'] });
  check('Rechaza farmacia incompleta', v2incompleta.status === 400, v2incompleta);
  const v3 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e3', respuesta1: 'Sí', respuesta2: 'Grooming' });
  check('Encuesta veterinaria registrada', v3.status === 201, v3);
  const v3incompleta = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e3', respuesta1: 'Sí' });
  check('Rechaza veterinaria sin motivo', v3incompleta.status === 400, v3incompleta);
  const v4 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e4', respuesta1: 'Sí', respuesta2: 'SUV', respuesta3: 'Más de ₡30.000' });
  check('Encuesta gasolina registrada', v4.status === 201, v4);
  const v4incompleta = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e4', respuesta1: 'Sí', respuesta2: 'Moto' });
  check('Rechaza gasolina sin gasto', v4incompleta.status === 400, v4incompleta);
  const v5 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e5', respuesta1: '2 – 3 veces', respuesta2: '₡20.001 – ₡30.000', respuesta3: 'Italiana' });
  check('Encuesta restaurantes registrada', v5.status === 201, v5);
  const v5incompleta = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e5', respuesta1: '1 vez', respuesta2: '₡0 – ₡20.000' });
  check('Rechaza restaurantes sin antojo', v5incompleta.status === 400, v5incompleta);
  const dupE1 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e1', despensa_ids: [desp.data[0].id] });
  check('Rechaza alacena repetida en Tótem 1', dupE1.status === 409, dupE1);
  const dupE2 = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e2' });
  check('Rechaza estación repetida', dupE2.status === 409, dupE2);
  const dup = await api('POST', '/visitas', { sesion_id: sesionId, estacion_codigo: 'e1' });
  check('Rechaza estación repetida', dup.status === 409, dup);

  const trasVisitas = await api('POST', '/totem/login', { personaje_id: zorro.id });
  check('Puntos acumulados > 0', trasVisitas.data.puntos === 430, trasVisitas.data);

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
  await api('POST', '/visitas', { sesion_id: ses3.data.id, estacion_codigo: 'e1', plato_id: (await api('GET', '/menu')).data[0].id });
  const dashSinPin = await fetch(BASE + '/dashboard');
  check('Dashboard rechaza sin PIN', dashSinPin.status === 401, { status: dashSinPin.status });
  const dash = await api('GET', '/dashboard', undefined, '1234');
  check('Dashboard responde', dash.status === 200 && Array.isArray(dash.data.activas), dash);
  check('Muestra ubicación en tiempo real', dash.data.activas.some(a => a.ubicacion === 'e1'), dash.data.activas);
  await api('POST', '/sesiones/liberar', { sesion_id: ses3.data.id });
  check('Dashboard trae tiempos por estación', Array.isArray(dash.data.tiempos) && dash.data.tiempos.length === 5, dash.data.tiempos);
  check('Total de estaciones = 5', dash.data.total_estaciones === 5, dash.data.total_estaciones);
  const histSinPin = await fetch(BASE + '/historial');
  check('Historial rechaza sin PIN', histSinPin.status === 401, { status: histSinPin.status });
  const hist = await api('GET', '/historial', undefined, '1234');
  check('Historial trae registros completos', hist.status === 200 && hist.data.sesiones.length >= 2 && 'telefono' in hist.data.sesiones[0] && 'visitas' in hist.data.sesiones[0], null);
  check('Historial trae total de estaciones', hist.data.total_estaciones === 5, hist.data.total_estaciones);
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
