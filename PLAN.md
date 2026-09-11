# PLAN — Tour Gamificado Multi-Tótem

Experiencia interactiva lineal. El usuario se registra en Tótem 0, elige un personaje que lo identifica en cada estación, avanza secuencialmente por 6 estaciones y al final recibe un premio; el personaje se libera para el siguiente visitante. Seguimiento en tiempo real desde dashboard.

## Requisitos confirmados

| Ítem | Valor |
|------|-------|
| Tótems | 7 (Tótem 0 Registro + Tótems 1–5 Estaciones + Tótem 6 Final con premio) — numeración 0–6 para que coincida con el número de estación |
| Usuarios simultáneos | 6 (uno por estación en el caso base) |
| Red | Internet — VPS en DigitalOcean (Opción A). Tótems por WiFi del evento contra `https://tour.tudominio.com` |
| Premio | Configurable (pool de códigos `TOUR-0001`… en BD; entrega protegida con PIN de staff) |
| Avatares | Genéricos (12 emojis) |

## Arquitectura (Opción A — Nube)

```
[T0 Registro] [T1 e1] [T2 e2] [T3 e3] [T4 e4] [T5 e5] [T6 Final]
       \          |      |      |      |      |      |       /
        └─────────┴──────┴──────┴──────┴──────┴──────┴───────┘
                              WiFi del evento
                                   │
                          VPS DigitalOcean
                            ├── Caddy (HTTPS)
                            ├── Node.js + Express + Socket.IO
                            ├── SQLite `data/tour.db` (WAL)
                            └── Dashboard + frontends estáticos
                                   │
                          GitHub Actions (push a main → deploy automático)
```

## Modelo de datos (SQLite `node:sqlite`)

- `usuarios`: id, nombre, telefono, email, consentimiento, creado_en
- `personajes`: id, nombre, avatar, estado (`disponible` | `en_tour`)
- `estaciones`: id, codigo (`registro`, `e1`…`e5`, `final`), nombre, orden, tipo, puntos
- `sesiones`: id, usuario_id, personaje_id, estado (`activa`|`completada`|`expirada`|`abandonada`), ubicacion (`registro`|`e1`…), iniciada_en, ultima_actividad_en, completada_en, premio
- `visitas`: id, sesion_id, estacion_id, puntos, timestamp (UNIQUE sesion+estacion)
- `premios`: id, tipo, valor, estado, sesion_id
- `config`: clave/valor (`staff_pin`, `timeout_min`)

## Flujo del usuario

1. **T0 Registro**: datos + consentimiento → grid de avatares disponibles → confirmación → `POST /sesiones` crea sesión con `ubicacion='registro'`, personaje pasa a `en_tour`. Pantalla de éxito con botón OK y auto-reset 15s.
2. **T1–T6 Estaciones** (`/estacion.html?e=eN`): solo se listan personajes cuya `ubicacion` es el paso anterior (`T1` muestra `registro`, `T2` muestra `e1`…). Al tocar su avatar → `POST /totem/login` actualiza `ubicacion`. Botón registra visita (`POST /visitas`), bloquea repetir estación. Botón "Salir del tour" libera personaje (`POST /sesiones/liberar`). Flujo estrictamente lineal — imposible saltarse pasos.
3. **T7 Final** (`/final.html`): lista solo personajes de `e6` → resumen + PIN de staff → `POST /finalizar` asigna premio del pool, marca `completada`, libera personaje. Botón "liberar sin premio".
4. **Timeout**: sesión `activa` sin actividad > `timeout_min` (configurable desde dashboard) → `expirada` y personaje a `disponible`.

## Stack real

- Backend: Node.js 25 + Express 4 + Socket.IO 4
- BD: SQLite vía `node:sqlite` (DatabaseSync, sin nativos)
- Frontends: HTML/CSS/JS vanilla (sin build), `public/` servido por Express, modo kiosco Chromium `--kiosk`, auto-reset por inactividad, retry de red, indicador de conexión
- Dashboard: `public/dashboard.html` — pestañas En vivo (ubicación actual por personaje, progreso, ritmo por estación) + Historial completo (filtrable, detalle expandible), protegido con PIN, export CSV, ajustes de timeout/PIN
- Despliegue: Droplet DO Ubuntu 22.04 + pm2 (`ecosystem.config.cjs`) + Caddy (HTTPS) + GitHub Actions (`.github/workflows/deploy.yml`)

## Estado de fases

| Fase | Estado |
|------|--------|
| 1. Diseño | Hecho |
| 2. Núcleo backend | Hecho (tests E2E 36/36) |
| 3. Tótems | Hecho |
| 4. Dashboard | Hecho |
| 5. Seguridad (PIN, flujo lineal, liberación, retry) | Hecho |
| 6. Despliegue DO | Archivos listos (`DEPLOY.md`, `Caddyfile`, `ecosystem.config.cjs`, CI) — pendiente crear Droplet |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Caída de internet del evento | Reintentos en frontends + estado de conexión; para blindaje total se puede añadir servidor local como fallback |
| Usuario abandona a mitad | Timeout configurable + liberación voluntaria |
| Dos usuarios eligen mismo avatar | Bloqueo transaccional en `POST /sesiones` (409) |
| Suplantación en estación | Flujo lineal + personaje solo visible en el paso correcto |
| Exposición de dashboard/premios | PIN de staff (`x-staff-pin`) en `GET /dashboard`, `GET /historial`, `POST /finalizar`, `GET /exportar.csv` |
| Datos personales | Mínimos campos + consentimiento; `data/tour.db` en `.gitignore`, backups privados |

## Próximo paso acordado

Definir **qué contendrá cada tótem** (pantallas, textos, interacciones y premios por estación).
