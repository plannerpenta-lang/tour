# Despliegue en VPS (Opción A)

## 1. Requisitos del VPS

- Ubuntu 22.04+, 1 vCPU / 1 GB RAM es suficiente
- Node.js 22+ (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`)
- Un dominio apuntando a la IP del VPS (ej. `tour.tudominio.com`)

## 2. Instalar la app

```bash
git clone https://github.com/plannerpenta-lang/tour.git
cd tour
npm install --omit=dev
node src/seed.js
```

## 3. Proceso persistente con pm2

```bash
sudo npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 startup && pm2 save   # arranca solo al reiniciar el VPS
```

> ⚠️ Cambia `STAFF_PIN` en `ecosystem.config.cjs` antes de producción.

## 4. HTTPS con Caddy (certificado automático)

```bash
sudo apt install -y caddy
sudo cp Caddyfile /etc/caddy/Caddyfile
# Edita /etc/caddy/Caddyfile y pon tu dominio real
sudo systemctl reload caddy
```

Caddy emite y renueva el certificado TLS automáticamente.

## 5. URLs para los tótems

Cada tótem abre en modo kiosco (Chromium `--kiosk`) una URL:

| Tótem | URL |
|-------|-----|
| Registro | `https://tour.tudominio.com/registro.html` |
| Estaciones | `https://tour.tudominio.com/estacion.html?e=e1` … `e4` |
| Final | `https://tour.tudominio.com/final.html` |
| Dashboard | `https://tour.tudominio.com/dashboard.html` |

## Alternativa: Cloudflare Tunnel (sin abrir puertos)

```bash
cloudflared tunnel create tour
cloudflared tunnel route dns tour tour.tudominio.com
cloudflared tunnel run --url http://localhost:3000 tour
```

## Respaldos

La BD completa vive en `data/tour.db`. Backup diario con cron:

```
0 * * * * sqlite3 /ruta/a/tour/data/tour.db ".backup /backups/tour-$(date +\%F-\%H).db"
```
