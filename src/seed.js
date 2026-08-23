const { db } = require('./db');

function seed() {
  const estaciones = db.prepare('SELECT COUNT(*) AS n FROM estaciones').get();
  if (estaciones.n === 0) {
    const ins = db.prepare('INSERT INTO estaciones (codigo, nombre, orden, tipo, puntos) VALUES (?, ?, ?, ?, ?)');
    ins.run('registro', 'Registro', 0, 'registro', 0);
    for (let i = 1; i <= 6; i++) {
      ins.run(`e${i}`, `Estación ${i}`, i, 'estacion', 100);
    }
    ins.run('final', 'Entrega de Premio', 7, 'final', 0);
    console.log('Estaciones creadas');
  }

  const personajes = db.prepare('SELECT COUNT(*) AS n FROM personajes').get();
  if (personajes.n === 0) {
    const avatares = ['🦊 Zorro', '🐨 Koala', '🐸 Rana', '🦉 Búho', '🐙 Pulpo', '🦁 León', '🐼 Panda', '🐧 Pingüino', '🦄 Unicornio', '🐢 Tortuga', '🐝 Abeja', '🦋 Mariposa'];
    const ins = db.prepare('INSERT INTO personajes (nombre, avatar) VALUES (?, ?)');
    for (const a of avatares) {
      const [emoji, nombre] = a.split(' ');
      ins.run(nombre, emoji);
    }
    console.log('Personajes creados');
  }

  const premios = db.prepare('SELECT COUNT(*) AS n FROM premios').get();
  if (premios.n === 0) {
    const ins = db.prepare("INSERT INTO premios (tipo, valor) VALUES ('codigo', ?)");
    for (let i = 1; i <= 50; i++) {
      ins.run(`TOUR-${String(i).padStart(4, '0')}`);
    }
    console.log('Premios creados');
  }
}

seed();
