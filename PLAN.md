# PLAN — Tour Gamificado Multi-Tótem

Experiencia interactiva con 6 tótems conectados por WiFi en red local.
El usuario se registra en el tótem inicial, elige un personaje que lo identifica
en cada estación, acumula progreso y al final recibe un premio; el personaje se
libera automáticamente para el siguiente visitante.

## Requisitos confirmados

| Ítem | Valor |
|------|-------|
| Tótems | 6 (1 registro + 4 estaciones + 1 final)* |
| Usuarios simultáneos | 6 (máx. 1 por tótem) |
| Red | WiFi, red local |
| Premio | Configurable (físico o digital) |
| Avatares | Genéricos |

*\*el número de estaciones intermedias debe ser configurable*

## Arquitectura

```
[T1 Registro] [T2] [T3] [T4] [T5] [T6 Final+Premio]
      \         |     |     |     |    /
       └────────┴── WiFi (LAN) ──────┘
                    │
        Servidor local (una PC del mismo router)
          ├── API REST + WebSocket
          ├── Base de datos embebida
          └── Dashboard web (tiempo real)
```

Sin nube: todo corre en la LAN. Un solo proceso Node.js sirve API,
frontends de tótems y dashboard.

## Modelo de datos

- `usuarios`: id, nombre, teléfono/email, consentimiento, creado_en
- `personajes`: id, nombre, avatar_url, estado (`disponible` | `en_uso` | `en_tour`)
- `sesiones`: id, usuario_id, personaje_id, estado (`activa` | `completada` | `expirada`), iniciada_en, completada_en
- `estaciones`: id, nombre, orden (configurable desde BD)
- `visitas`: id, sesion_id, estacion_id, puntos, timestamp

## Flujo del usuario

1. **T1 Registro**: datos personales + consentimiento → grid de avatares disponibles → personaje queda bloqueado para él
2. **T2–T5 Estaciones**: toca su avatar (solo se listan personajes `en_uso`) → gana puntos/logro → queda registrado en su sesión
3. **T6 Final**: toca su avatar → resumen del recorrido → entrega de premio → personaje pasa a `disponible`
4. **Timeout**: si un usuario abandona, la sesión expira tras N minutos de inactividad y el personaje se libera solo

## Stack propuesto

- Backend: Node.js + Express + Socket.IO
- BD: SQLite (embebida, cero instalación, suficiente para 6 usuarios)
- Frontends: React (Vite) — una app de registro, un componente genérico de estación parametrizado por `estacion_id`, app final, dashboard
- Kiosco: navegador Chromium fullscreen (modo kiosco), auto-reset a pantalla idle

## Fases de desarrollo

| Fase | Entregable | Estimación |
|------|-----------|------------|
| 1. Diseño | Flujos UX, avatares genéricos, branding | 3 días |
| 2. Núcleo backend | Registro, bloqueo de personaje, API de progreso, timeouts | 4 días |
| 3. Tótems | App registro + componente genérico de estación + app final | 5 días |
| 4. Dashboard | Seguimiento en vivo: sesiones activas, ocupación, premios | 3 días |
| 5. Cierre | Lógica premio/liberación, pruebas E2E con los 6 tótems | 3 días |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Caída de WiFi | Los tótems reintentan y muestran estado de conexión; servidor local evita depender de internet |
| Usuario abandona a mitad | Timeout automático de sesión (ej. 15 min) + liberación de personaje |
| Dos usuarios eligen el mismo avatar | Bloqueo transaccional central en el momento del toque |
| Navegador del tótem se sale del modo kiosco | Auto-reset por inactividad + arranque automático del navegador |
| Datos personales | Mínimos campos + checkbox de consentimiento (ley de datos) |
