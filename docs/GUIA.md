# 📗 Guía del Canal de Contingencia WhatsApp → Excel en Drive (rclone) (elecciones-fnc)

> Documento vivo. Se actualiza conforme avanza la implementación.
> Última versión: v4 — coordinadores en caliente (panel), importación desde el Sheet, plantilla descargable e informes/alertas en el panel.

---

## 1. Propósito

Canal **alternativo** de reporte electoral por WhatsApp para cuando el aplicativo web no está disponible
(por falla del servidor, de conectividad del dispositivo del coordinador, o por carga). Los coordinadores
reportan los **3 momentos** de cada mesa por su número de WhatsApp de seccional; un bot los valida, evita
duplicados y los vuelca a una **hoja de cálculo en Google Drive (Workspace)**.

El bot y el app funcionan **en paralelo, con o sin API del app**: el bot es autónomo y no depende del app
para operar (salvo un refresco opcional del maestro de mesas).

---

## 2. Decisiones acordadas (resumen)

| Tema | Decisión |
|---|---|
| Proveedor WhatsApp | **Evolution API** (self-hosted, multi-instancia = 1 por seccional) |
| Destino de los datos | **Un único `.xlsx` en Google Drive** (fuente de verdad; humanos editan en Sheets web). El bot sincroniza vía `rclone` (sin proyecto Google Cloud). |
| Estilo de captura | **Bot conversacional guiado** paso a paso |
| Disponibilidad | App y bot en paralelo; el bot es autónomo |
| Planchas en 021 | **5 planchas** (como el acta 021 del app 2026) |
| Consolidado | **Sí**, hoja CONSOLIDADO con totales y alertas por seccional |
| Cierre de jornada | **Bloqueo total** del bot tras horario; solo admin corrige en Drive |
| Corrección post-cierre | Quien tenga **acceso al documento en Drive** |
| Auth del panel | **Propia del bot** (admin/user/pass, independiente del app) |
| Números | **Uno por seccional**; reasignación en caliente vía panel |
| API Key Evolution | Secreto **auto-generado** (`openssl rand -hex 32`), no de Meta |

---

## 3. Arquitectura

```
[Coordinador]─WhatsApp─▶[Evolution API] (1 instancia / seccional, en Docker)
                                │ webhook interno
                                ▼
                         [Bot Node] ──googleapis──▶ [Google Sheet Workspace]
                          │  │  │
            webhook   panel admin (hot-swap)   sesiones/maestro (SQLite local)
                          ▼
                   [Operador] navega /admin/ui para reasignar números
```

- Evolution y bot en la misma red Docker (`infra-net`). No se expone nada salvo el panel admin (puerto `8090`
  vía NPM/túnel) y la UI de Evolution (puerto `8082` solo para escanear QR).
- El bot escribe por `CÓDIGO MESA` (o `SECCIONAL+NUMERO_MESA+MUNICIPIO VOTA` cuando la mesa vota por varios municipios).

---

## 4. Los 3 momentos (modelo de datos)

La mesa se identifica por `codigo` / `codigoMesa`. Campos capturados:

- **Instalación**: `jurados(0-3)`, `kitElectoral(Recibido|No Recibido)`, `sillas(Completas|No Completas)`,
  `mesa(Está|No Está)`, `observaciones?`.
  `INSTALADA = jurados=3 ∧ kit=Recibido ∧ sillas=Completas ∧ mesa=Está`.
- **Participación**: `numeroReporte(1-3)`, `sufragantes`, `observaciones?`.
  Reglas: debe existir el reporte N-1 y los sufragantes no decrecen.
- **Acta 021**: `plancha1..5`, `blanco`, `nulos`, `noMarcados`, `totalVotosMesa`, `incinerados?`, `otrasConstancias?`.
  **Cuadre**: `Σplanchar + blanco + nulos + noMarcados == totalVotosMesa`.

---

## 5. La plantilla de Excel (`3_PRECONTEO 2022-PLANCHAS.xlsx`)

Generada por `scripts/build-template.js` (lee el original en `docs/contexto` del app). Hojas:

- **PRECONTEO** (A–Y): catálogo + 5 planchas + incinerados + `V=SUM(N:U)` +
  `W=IF(L=V,"SI","NO")` CONTROL + `X=L-V` DESCUADRE + `Y` ALERTA.
- **INSTALACION** (A–U): catálogo + `INSTALADA` + `ALERTA` + trazabilidad
  (`REPORTADO_POR/FECHA/VERSION/ESTADO`).
- **PARTICIPACION** (A–V): catálogo + B1/B2/B3 + `TOTAL` + `ALERTA` + trazabilidad.
- **CONSOLIDADO** (A–I): una fila por seccional con `COUNTIFS`/`SUMIFS` (mesas total, instaladas,
  alerta instalación, sufragantes, votos 021, reportadas, cuadre OK, descuadre) + fila TOTAL.
- **HISTORIAL**: `timestamp, línea, teléfono, mesa, momento, campo, valor_anterior, valor_nuevo, motivo`.

**Alertas de color**: se aplican en Drive vía Sheets API (`AddConditionalFormatRule`). En el xlsx local quedan
como texto `ALERTA`/`OK`/`PENDIENTE`. Verificado: 1052 mesas, 9 seccionales, fórmulas presentes y cuadre correcto.

---

## 6. El bot (`src/`)

- `flows.js`: máquina de estados conversacional (menú → mesa → campo a campo → confirmar). Comandos
  `CANCELAR`, `CORREGIR`, `AYUDA`. Valida cada dato y re-pregunta con ejemplo.
- `validators.js`: misma semántica que el app (rangos, enums, cuadre 021, no-decrecimiento).
- `evolution.js`: cliente HTTP de Evolution (enviar texto, crear instancia, fijar webhook, estado).
- `sheets.js`: escribe los 3 momentos en la hoja por código de mesa y registra en HISTORIAL.
- `state.js`: SQLite local (líneas seccional↔instancia, sesiones, admins).
- `maestro.js`: catálogo de mesas/coordinadores (de `config/mesas.json`, exportado del app) para validar y
  hacer scoping aunque el app caiga.
- `admin.js` + `public/admin.html`: panel web (auth propia) para **reasignar números por seccional en caliente**.
- `index.js`: webhook `/webhook/evolution` + panel + `/health`.

---

## 7. ¿Qué es Evolution API? (a fondo)

**Evolution API** es una pasarela de mensajería de código abierto (Node.js/TypeScript) que expone **WhatsApp
como un servicio HTTP**. Permite enviar/recibir mensajes, media e historial mediante REST API y webhooks,
sin depender de la API oficial de Meta.

**Cómo se conecta a WhatsApp:**
- No usa la API oficial (ni Meta Cloud API ni Twilio). Cada **instancia** mantiene una **sesión de WhatsApp Web**
  mediante la librería **Baileys** (protocolo WA Web por ingeniería inversa). Por eso **no requiere aprobar una
  cuenta de negocio ni pagar por mensaje**.
- La sesión se inicia **escaneando un QR** con el WhatsApp del número (igual que WA Web en el navegador). Persiste
  en el almacenamiento de Evolution.
- Soporta **varias instancias en un solo contenedor**: cada seccional = una instancia con su propio número. Clave
  para el diseño "un número por seccional".

**Componentes internos:**
- `evolution-api`: servicio HTTP. Necesita BD para instancias/sesiones (recomendado **PostgreSQL**).
- **Webhooks**: URL a la que Evolution empuja eventos (`MESSAGES_UPSERT`, `CONNECTION_UPDATE`, etc.). Usamos `MESSAGES_UPSERT`.
- **REST API**: `/message/sendText`, `/instance/create`, `/instance/connectionState`, `/webhook/set`. Protegidas por header `apikey`.

**Diferencia con alternativas:**
| | Evolution API | Meta Cloud API | Twilio |
|---|---|---|---|
| Aprobación Meta | No | Sí | Sandbox rápido |
| Costo por mensaje | No | Sí | Sí |
| Riesgo de ban | **Sí** (ToS no oficial) | No | No |
| Número | Tu WA normal | Número negocio | Número Twilio |
| Self-host | Sí | No | No |

**Riesgo de ban:** al usar el protocolo no oficial, Meta *puede* banear el número. Se mitiga con números dedicados,
tráfico conocido/acotado y rotación vía panel. Para riesgo cero, usar Meta Cloud API (requiere cambiar proveedor).

**Requisitos:** Docker, Postgres, y un número de WhatsApp con su QR escaneable. Imagen oficial `evolutionap/evolution-api:latest`.

---

## 8. Infraestructura

**Stack (Docker Compose en `infra-net`):**

```
┌─────────────────────────────────────────────────────────────┐
│ Red Docker: infra-net (compartida con elecciones-fnc)          │
│                                                                │
│  [postgres]  ←──  [evolution-api]  ──webhook──▶  [bot]         │
│   (estado                 (1 instancia              │ googleapis
│    instancias)            por seccional)             ▼
│                                     [Google Sheet Workspace]  │
│                                        ▲                       │
│  [Operador] ──NPM/túnel──▶ bot:8090 (/admin/ui)  │            │
│  [Operador] ──NPM/túnel──▶ evolution:8082 (QR)    │            │
└─────────────────────────────────────────────────────────────┘
```

**Servicios (`docker-compose.yml`):**
1. **postgres** (`postgres:16-alpine`): credenciales vía env; volumen `evolution-pg`. Healthcheck `pg_isready`.
2. **evolution-api** (`evolutionap/evolution-api:latest`):
   - `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI=postgres://...@postgres:5432/evolution`.
   - `AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}` (key global).
   - Puerto **8082** publicado solo para escanear QR (ciérralo tras emparejar).
   - Volumen `evolution-store` para la sesión WA.
3. **bot** (imagen build local): `BOT_PORT=8090`; volúmenes `bot-data` (SQLite), `./secrets` (cuenta de servicio
   Google, **ro**), `./config` (maestro, **ro**). Red `infra-net`.

**Redes:** bot y Evolution se comunican por DNS interno (`evolution-api:8080`, `bot:8090`). No se publica `:8080` de
Evolution ni del bot; solo `:8090` (panel) y `:8082` (QR) vía NPM/Cloudflare, en el rango libre `8090–8190`.

**Secretos:** `.env` gitignored (no se hornea en imagen; `.dockerignore` lo excluye). En producción viven en
Dockge/Portainer o `.env` del host, inyectados por `${...}`. La cuenta de servicio de Google se monta como archivo en
`/app/secrets/`.

**Relación con elecciones-fnc:** stack **separado** (no acopla build/restart del app). Comparte `infra-net` para poder,
opcionalmente, leer `GET /api/mesas` del app cuando está arriba (refresco del maestro).

---

## 9. Despliegue paso a paso (producción)

**0. Prerrequisitos**
- Servidor Ubuntu con Docker + Compose (o Dockge en `/opt/stacks`).
- Acceso a la red `infra-net`.
- Un número de WhatsApp **por seccional** (con celular/plan donde escanear el QR).
- Cuenta de Google Workspace + permiso para crear **cuenta de servicio**.

**1. API Key de Evolution**
```bash
openssl rand -hex 32
```
Copiar el valor en `.env` como `EVOLUTION_API_KEY`. Misma que usa el bot (header `apikey`).

**2. Google Workspace (cuenta de servicio + hoja)**
- Google Cloud: crear proyecto → **Cuenta de servicio** → generar JSON key.
- Compartir el Spreadsheet de Drive con el email de esa cuenta de servicio con rol **Editor**.
- Subir `3_PRECONTEO 2022-PLANCHAS.xlsx` a Drive y copiar su **ID** (de la URL) en `GOOGLE_SHEET_ID`.
- Guardar el JSON en `whatsapp-bot/secrets/google-service-account.json`.

**3. Configurar `.env`**
- `EVOLUTION_API_KEY`, `GOOGLE_CREDENTIALS_JSON=/app/secrets/google-service-account.json`, `GOOGLE_SHEET_ID`,
  `APP_MESAS_URL` (opcional), `SECCIONALES_VALIDAS`, `CIERRE_HORARIO` (ej. `17:00`), `ADMIN_USER`,
  `ADMIN_PASS_HASH` (`node -e "console.log(require('bcryptjs').hashSync('tu_pass',10))"`), `POSTGRES_PASSWORD`.

**4. Catálogo de mesas**
```bash
node scripts/export-maestro.js   # lee data/elecciones.db del app → config/mesas.json + coordinadores.json
```
(O edita `config/mesas.json` a mano si no hay DB a mano.)

**5. Build y arranque**
- Con Dockge: apuntar al `docker-compose.yml` de este stack, poner env, **Up**.
- O build local + SCP al server + `docker compose up -d` (patrón igual a `deploy.ps1` del app).
- `GET /health` del bot debe responder `healthy`.

**6. Emparejar números (por seccional)**
- Abrir `evolution:8082` vía NPM/túnel en el navegador del operador.
- Por cada seccional: crear instancia (nombre = seccional, ej. `chaparral`), escanear QR con el WA de esa seccional.
- Verificar estado `open` en la UI de Evolution.

**7. Registrar líneas en el panel**
- Entrar a `bot:8090/admin/ui` con `ADMIN_USER`/`ADMIN_PASS_HASH`.
- Por cada seccional: `SECCIONAL` = nombre de instancia, `instancia` = mismo nombre, `teléfono` = número, activar.
  El `PUT /admin/lineas` crea la instancia en Evolution (si no existe) y fija su webhook al bot.
- El bot ahora enruta los mensajes de esa instancia a esa seccional.

**8. Verificación**
- `GET /admin/lineas/estado` → todas `open`.
- Prueba con un coordinador: enviar "hola" → menú; reportar una mesa → confirmar → fila actualizada en Drive +
  entrada en HISTORIAL.

---

## 10. Uso en producción

**Coordinador (flujo diario):**
1. Escribe al número de su seccional → recibe el menú (1 Instalación / 2 Participación / 3 Acta 021).
2. Elige momento → bot pide **código de mesa** → valida que exista y sea de su seccional.
3. Responde campo a campo (con ejemplos y re-pregunta si falla).
4. Al final ve un **resumen** y confirma con `SI`. El bot escribe en Drive y responde `✅ registrada`.
5. Comandos en cualquier momento: `CANCELAR`, `CORREGIR`, `AYUDA`.

**Operador (panel):**
- Monitorea `estado` de cada línea WA (`open`/`connecting`/`error`).
- Si un número se **banea**: lo marca `baneada` (o desactiva) y, si hay número de respaldo ya emparejado,
  **reasigna** la seccional a esa instancia en segundos (hot-swap, sin reiniciar).
- Consulta `CONSOLIDADO` en Drive para totales por seccional.

**Cierre de jornada:**
- Al llegar `CIERRE_HORARIO`, el bot responde "jornada cerrada" y rechaza ediciones por WhatsApp.
- Las correcciones posteriores se hacen **directamente en el documento de Drive** por quien tenga acceso.

**Auditoría:**
- Todo lo que escribe el bot queda en la hoja `HISTORIAL` (timestamp, línea, teléfono, mesa, momento, campo,
  valor antes/después, motivo).

---

## 11. Errores humanos y antifraude

- **Identidad**: teléfono en whitelist (`coordinadores.json`); número no autorizado no reporta.
- **Scoping**: cada línea solo acepta mesas de su seccional.
- **Una sola respuesta**: estado `PENDIENTE → CONFIRMADA` con confirmación explícita; re-envío previo al cierre =
  `CORREGIR`+motivo (log HISTORIAL).
- **Bloqueo por cierre**: tras `CIERRE_HORARIO` el bot rechaza ediciones; corrección solo manual en Drive.
- **Trazabilidad**: todo lo escrito por el bot queda en HISTORIAL.

---

## 12. Multi-línea por seccional y riesgo de ban

- Un número dedicado por seccional reduce el riesgo de ban (tráfico acotado, conocido) y aísla el impacto.
- **Riesgo real**: Evolution usa el protocolo no oficial de WA Web → Meta puede banear el número. Mitigación: números
  dedicados, no spam, y rotación vía panel si se banea. Sustituir por la API oficial de Meta/Twilio elimina el riesgo
  pero exige aprobación/costo.

---

## 13. Operación continua

- **Backups**: volumen `evolution-pg`, `evolution-store` (sesiones WA), `bot-data` (SQLite de líneas/sesiones).
  Respaldar periódicamente; las sesiones WA emparejadas NO se regeneran solas (un backup evita re-escanear QR).
- **Actualizaciones**: rebuild de la imagen del bot + `up -d`; Evolution rara vez cambia.
- **Observabilidad**: logs del contenedor `bot` (errores de webhook/Sheets); `GET /health` para probes.
- **Escalamiento**: un solo bot basta para las ~9 seccionales/miles de mesas; Evolution aguanta el volumen.
- **Seguridad**: `.env` y cuenta de servicio fuera del repo; panel admin con su propio login (token 8 h).

---

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Ban de número WA | Números dedicados, tráfico acotado, rotación en caliente vía panel |
| Caída del servidor del bot | Stack aislado; el app sigue igual. Backup de `bot-data`/`evolution-store` |
| Dato erróneo humano | Validación en ingreso + confirmación + comando CORREGIR |
| Fraude / mesa ajena | Whitelist de teléfono + scoping por seccional |
| Alteración tardía | Lock por `CIERRE_HORARIO`; correcciones solo en Drive con auditoría |

---

## 15. Checklist final de producción

- [ ] `.env` completo y secreto fuera del repo
- [ ] Cuenta de servicio Google con Editor sobre la hoja; `GOOGLE_SHEET_ID` correcto
- [ ] `config/mesas.json` y `coordinadores.json` presentes
- [ ] Stack `up`; `/health` healthy; Evolution y bot en `infra-net`
- [ ] Números emparejados (QR) y registrados en el panel; `estado=open`
- [ ] Prueba de extremo a extremo (un reporte real → Drive + HISTORIAL)
- [ ] `CIERRE_HORARIO` definido y comunicado

---

## 16. Validación realizada (hasta ahora)

- `node --check` OK en los 12 módulos (config, validators, state, maestro, flows, evolution, sheets, admin, index, build-template, export-maestro, test).
- `npm install --ignore-scripts` → 100 paquetes instalados; el bot es ejecutable localmente (Windows, sin compilar better-sqlite3).
- `node scripts/export-maestro.js` → **224 mesas** y **189 coordinadores con teléfono** exportados desde la DB real
  del app (`elecciones-fnc/data/elecciones.db`) a `config/mesas.json` + `config/coordinadores.json`.
- `node test/logic.test.js` → ✅ flujo acta 021 (cuadre OK y descuadre), instalación, participación (2 boletines),
  validadores y rechazo de línea no autorizada.
- Plantilla Excel verificada: 1052 mesas, 9 seccionales, fórmulas presentes y cuadre correcto (PRECONTEO V2=169, CONTROL=SI).
- **Formato condicional de color en Drive implementado** (`sheets.applyConditionalFormatting`): resalta `ALERTA`
  (rojo) y `OK` (verde) en la columna de estado de PRECONTEO/INSTALACION/PARTICIPACION; se limpia antes de re-aplicar
  para no duplicar reglas en reinicios. Verificado carga del módulo.

## 17. Pendientes / siguientes pasos

- Prueba end-to-end con Evolution + Sheets reales (requiere credenciales: `EVOLUTION_API_KEY`, cuenta de servicio Google, `GOOGLE_SHEET_ID`).
- (Opcional) refresco automático del maestro desde `GET /api/mesas` del app.
- Documentar procedimiento de rotación de un número baneado con capturas paso a paso.

## 18. Addendum v4 — coordinadores, importación, plantilla e informes

> Cambios respecto a v2/v3: el coordinador de mesa y el coordinador seccional **se gestionan en caliente
> desde el panel web del bot** y **se leen del mismo Excel en Drive** (fuente única). La plantilla ahora
> trae una hoja `SECCIONALES` y columnas de coordinador de mesa en `PRECONTEO`, y el panel puede
> **importar** todo desde el Sheet y **descargar** la plantilla lista para rellenar.

### 18.1 Coordinadores (panel, en caliente)
- **Coordinador de mesa**: 1 teléfono ↔ 1 mesa (fila PRECONTEO = código + municipio). En el panel
  (`/admin/coordinadores`, pestaña *Coordinadores*) se crea/editan/eliminan con `POST/PUT/DELETE
  /admin/coordinadores/mesa` (body: `codigo, municipio, seccional, nombre, contacto`). El bot escribe el
  nombre/contacto en `PRECONTEO!Z/AA` de la fila correspondiente.
- **Coordinador seccional**: 1 teléfono ↔ todas las mesas de su seccional. CRUD en `/admin/coordinadores/seccional`
  (body: `seccional, nombre, contacto, municipio, circunscripcion, numero`). El bot escribe
  `SECCIONALES` (una fila por seccional).
- Tras cualquier cambio, el panel recarga `sheets.getCoordinadores()` en memoria (sin reiniciar).
- El **guion valida la asignación**: al resolver la mesa, un coordinador de mesa solo puede reportar su fila
  asignada; un coordinador seccional, cualquier mesa de su seccional; si no → `⛔ No estás asignado a la mesa X`.
  Un teléfono no autorizado → `⛔ Este número no está autorizado para reportar`.

### 18.2 Importación desde el Sheet
- `POST /admin/importar` (o `node scripts/importar-datos.js`) lee `PRECONTEO` + `SECCIONALES` del Sheet y
  reescribe `config/mesas.json` (catálogo de 1052 mesas) y los números de línea por seccional (`state.upsertLinea`).
- Esto permite alimentar el bot desde el mismo Excel de Workspace: rellenas el catálogo + números allí, subes a
  Drive y pulsas *Importar*. El app `elecciones-fnc` queda desacoplado (el bot es autónomo).

### 18.3 Plantilla descargable
- `GET /admin/plantilla` entrega `3_PRECONTEO 2022-PLANCHAS.xlsx` como `plantilla-contingencia.xlsx`.
- La plantilla trae: `PRECONTEO` (hasta `AA CONTACTO COORD MESA`, con fórmulas de cuadre y formato condicional),
  `SECCIONALES`, `CONSOLIDADO`, `HISTORIAL` y la hoja de planchas. `scripts/build-template.js` la regenera.

### 18.4 Informes y alertas tempranas (panel, sin WhatsApp ni Sheet)
- `GET /admin/informes` agrega por seccional y por circunscripción: instaladas, alertas de instalación,
  boletines, sufragantes, 021 (control/cuadre OK/descuadre) y proyección de planchas; más una lista de
  **alertas** (mesas sin instalar, 021 en descuadre, instalación en ALERTA). Se muestran en la pestaña
  *Informes* del panel. **No se escribe nada al Sheet ni se envía por WhatsApp** (evita ruido/spam).

### 18.5 Verificación v4 (modo degradado sin credenciales)
- `node --check` OK en los 12 módulos.
- `node test/logic.test.js` → ✅ 7/7 (acta 021 cuadre OK/descuadre, instalación, participación 2 boletines,
  validadores, línea no asociada, **validación de asignación coordinador de mesa**).
- Arranque del server: `/health` 200 (`mesas:224, seccionales:9`), login `/admin/login` → token firmado HMAC.
- Pendiente de runtime real: escritura/lectura Google Sheets, webhook Evolution y `/admin/importar` (requieren
  `EVOLUTION_API_KEY`, `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_SHEET_ID`).
