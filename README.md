# Bot de contingencia WhatsApp → Google Sheets (elecciones-fnc)

Canal alternativo de reporte electoral por WhatsApp para cuando el aplicativo web no está disponible.
Un número de WhatsApp **por seccional** alimenta una hoja de cálculo en Google Drive con los 3 momentos
(Instalación, Participación y Acta 021), validando datos, evitando duplicados y registrando auditoría.

## Arquitectura
- **Evolution API** (self-hosted, una instancia por seccional) recibe los mensajres de WhatsApp.
- **Bot** (Node/Express): webhook de Evolution + conversación guiada + escritura en Google Sheets + panel admin.
- **Google Sheets** (Workspace): plantilla `3_PRECONTEO 2022-PLANCHAS.xlsx` con hojas PRECONTEO / INSTALACION / PARTICIPACION / CONSOLIDADO / HISTORIAL.

## Setup
1. `cp .env.example .env` y completa: `EVOLUTION_API_KEY`, ruta a la cuenta de servicio de Google, `GOOGLE_SHEET_ID`, `ADMIN_PASS_HASH` (`node -e "console.log(require('bcryptjs').hashSync('tu_pass',10))"`).
2. Catálogo de mesas: `node scripts/export-maestro.js` (lee la DB del app) o edita `config/mesas.json` / `config/coordinadores.json`.
3. Plantilla: ya generada en `3_PRECONTEO 2022-PLANCHAS.xlsx`. Súbela a Drive y usa su ID en `GOOGLE_SHEET_ID`.
   Para regenerarla: `node scripts/build-template.js`.
4. `docker compose up -d` (red `infra-net`).
5. Por cada seccional: crea la instancia en Evolution (escanea el QR en el puerto 8082) y regístrala en el
   panel `/admin/ui` (seccional ↔ instancia/number). El panel permite **reasignar en caliente** si un número se banea.

## Seguridad / control de fraude
- Teléfono vinculado a coordinador conocido (whitelist en `coordinadores.json`); número no autorizado no reporta.
- Scoping por seccional: cada línea solo acepta mesas de su seccional.
- Una sola respuesta confirmada por mesa (`ESTADO`); tras el cierre de jornada (`CIERRE_HORARIO`) el bot se bloquea y las correcciones se hacen en Drive.
- Todo lo que escribe el bot queda en la hoja `HISTORIAL` (timestamp, línea, teléfono, mesa, campo, valor anterior/nuevo, motivo).

## Pruebas
- `node test/logic.test.js` valida el flujo conversacional y los validadores sin servicios externos.
- `node -e "require('./src/validators');require('./src/flows')"` comprueba la carga de módulos.

## Notas
- El bot usa `better-sqlite3`; en Windows instálalo con `npm install --ignore-scripts` (binario precompilado).
- Reemplazar un número baneado por uno totalmente nuevo exige escanear su QR una vez; el panel solo reasigna líneas ya emparejadas.
