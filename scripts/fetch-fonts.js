const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function bajar(familia, pesos) {
  const url = `https://fonts.googleapis.com/css2?family=${familia}:wght@${pesos.join(';')}&display=swap`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const bloques = css.split('/*').slice(1);
  for (const b of bloques) {
    const subset = b.split('*/')[0].trim();
    if (subset !== 'latin') continue;
    const peso = b.match(/font-weight:\s*(\d+)/)[1];
    const fuente = b.match(/url\((https:[^)]+\.woff2)\)/)[1];
    const nombre = `${familia.toLowerCase()}-${peso}.woff2`;
    const buf = Buffer.from(await (await fetch(fuente)).arrayBuffer());
    fs.writeFileSync(path.join(OUT, nombre), buf);
    console.log(nombre, buf.length + ' bytes');
  }
}

(async () => {
  await bajar('Nunito', [700, 800]);
  await bajar('Inter', [400, 600, 700]);
})();
