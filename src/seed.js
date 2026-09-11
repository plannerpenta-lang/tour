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

  const platos = db.prepare('SELECT COUNT(*) AS n FROM platos').get();
  if (platos.n === 0) {
    const ins = db.prepare('INSERT INTO platos (nombre, descripcion, emoji, puntos, stock, stock_inicial) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('Casado Típico', 'Arroz, frijoles, plátano, ensalada, chuleta', '🍛', 100, 15, 15);
    ins.run('Arroz con Pollo', 'Arroz, pollo, verduras y papas', '🍗', 120, 12, 12);
    ins.run('Olla de Carne', 'Carne, yuca, elote, verduras', '🍲', 150, 8, 8);
    ins.run('Chifrijo', 'Arroz, frijoles, chicharrón, pico de gallo', '🥘', 100, 10, 10);
    ins.run('Gallo Pinto Especial', 'Gallo pinto, huevo, natilla, tortilla', '🍳', 80, 20, 20);
    ins.run('Sopa Negra', 'Frijoles, huevo, arroz y culantro', '🥣', 130, 10, 10);
    ins.run('Arroz con Camarones', 'Arroz, camarones, verduras', '🦐', 150, 6, 6);
    ins.run('Casado Vegetariano', 'Arroz, frijoles, vegetales, ensalada', '🥗', 110, 10, 10);
    console.log('Platos creados');
  }
}

seed();
