const { db } = require('./db');

function seed() {
  const estaciones = db.prepare('SELECT COUNT(*) AS n FROM estaciones').get();
  if (estaciones.n === 0) {
    const ins = db.prepare('INSERT INTO estaciones (codigo, nombre, orden, tipo, puntos) VALUES (?, ?, ?, ?, ?)');
    ins.run('registro', 'Registro', 0, 'registro', 0);
    for (let i = 1; i <= 5; i++) {
      ins.run(`e${i}`, `Estación ${i}`, i, 'estacion', 100);
    }
    ins.run('final', 'Entrega de Premio', 6, 'final', 0);
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

  const productos = db.prepare('SELECT COUNT(*) AS n FROM productos').get();
  if (productos.n === 0) {
    const ins = db.prepare('INSERT INTO productos (nombre, descripcion, emoji, precio, puntos, estacion) VALUES (?, ?, ?, ?, ?, ?)');
    // e2 = Farmacia
    ins.run('Acetaminofén 500mg', '20 tabletas', '💊', 8.00, 60, 'e2');
    ins.run('Ibuprofeno 400mg', '16 cápsulas', '💊', 9.50, 70, 'e2');
    ins.run('Vitamina C 1000mg', '30 tabletas', '🍊', 15.00, 90, 'e2');
    ins.run('Alcohol en Gel 250ml', '70% alcohol', '🧴', 6.00, 50, 'e2');
    ins.run('Curitas Variadas x40', 'Resistentes al agua', '🩹', 7.00, 55, 'e2');
    ins.run('Jarabe para la Tos 120ml', 'Miel y eucalipto', '🍯', 11.00, 75, 'e2');
    ins.run('Protector Solar SPF50 100ml', 'Alta protección', '☀️', 18.00, 100, 'e2');
    ins.run('Termómetro Digital', 'Lectura rápida', '🌡️', 13.00, 85, 'e2');
    // e3 = Veterinaria (duplicado)
    ins.run('Pipeta Antiparasitaria', 'Perro mediano, 1 dosis', '🐩', 18.00, 100, 'e3');
    ins.run('Shampoo Hipoalergénico 500ml', 'Avena y aloe', '🧴', 14.00, 80, 'e3');
    ins.run('Vitaminas Condroprotectores', '30 tabletas', '💊', 22.00, 120, 'e3');
    ins.run('Alimento Premium 2kg', 'Pollo y arroz', '🦴', 28.00, 150, 'e3');
    ins.run('Collar Antipulgas', '8 meses protección', '🔗', 16.00, 90, 'e3');
    ins.run('Desparasitante Interno', '2 comprimidos', '🩹', 12.00, 70, 'e3');
    ins.run('Juguete Interactivo', 'Cuerda y mordedor', '🧸', 10.00, 60, 'e3');
    ins.run('Transportadora Plegable', 'Talla M', '🧳', 45.00, 180, 'e3');
    console.log('Productos creados');
  } else if (productos.n === 8) {
    db.prepare("UPDATE productos SET estacion = 'e3'").run();
    const ins = db.prepare('INSERT INTO productos (nombre, descripcion, emoji, precio, puntos, estacion) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('Acetaminofén 500mg', '20 tabletas', '💊', 8.00, 60, 'e2');
    ins.run('Ibuprofeno 400mg', '16 cápsulas', '💊', 9.50, 70, 'e2');
    ins.run('Vitamina C 1000mg', '30 tabletas', '🍊', 15.00, 90, 'e2');
    ins.run('Alcohol en Gel 250ml', '70% alcohol', '🧴', 6.00, 50, 'e2');
    ins.run('Curitas Variadas x40', 'Resistentes al agua', '🩹', 7.00, 55, 'e2');
    ins.run('Jarabe para la Tos 120ml', 'Miel y eucalipto', '🍯', 11.00, 75, 'e2');
    ins.run('Protector Solar SPF50 100ml', 'Alta protección', '☀️', 18.00, 100, 'e2');
    ins.run('Termómetro Digital', 'Lectura rápida', '🌡️', 13.00, 85, 'e2');
    console.log('Productos farmacia agregados');
  }

  const comb = db.prepare('SELECT COUNT(*) AS n FROM combustible').get();
  if (comb.n === 0) {
    const ins = db.prepare('INSERT INTO combustible (monto, etiqueta, descripcion, emoji, puntos) VALUES (?, ?, ?, ?, ?)');
    ins.run(5000, '₡5.000', '1/4 tanque', '⛽', 60);
    ins.run(10000, '₡10.000', 'Medio tanque', '⛽', 100);
    ins.run(18000, '₡18.000', 'Tanque lleno', '⛽', 160);
    ins.run(7500, '₡7.500', '1/3 tanque', '⛽', 80);
    ins.run(15000, '₡15.000', '3/4 tanque', '⛽', 130);
    console.log('Combustible creado');
  }
}

seed();
