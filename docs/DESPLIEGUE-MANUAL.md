# 🛠️ Runbook manual — dejar operativo el Canal de Contingencia (WhatsApp → Sheets)

> Lo que **tú** debes hacer a mano, fuera del código. El bot ya está construido y corre en Docker
> (`elecciones-bot`). Estos pasos conectan Evolution API (WhatsApp) y Google Sheets (Drive),
> alimentan el catálogo y exponen el webhook.

---

## 0. Prerrequisitos

- Docker Desktop corriendo (ya tienes `elecciones-bot` levantado en `:8090`).
- Una **cuenta de Google Workspace** con acceso a Google Sheets (la hoja vive en Drive).
- Un servidor/PCl para **Evolution API** (puede ser el mismo host de Docker o remoto).
- Los números de WhatsApp de cada seccional, con su teléfono físico a mano para escanear el QR.

---

## 1. Evolution API (un contenedor, una instancia por seccional)

### 1.1 Levantar Evolution
Usa el compose oficial de Evolution API (necesita Postgres + Redis). Ejemplo mínimo
(ajusta la versión/imagen a la de tu servidor):

```yaml
# evolution/docker-compose.yml
services:
  evolution:
    image: atkbr/evolution-api:latest
    ports: ["8080:8080"]
    environment:
      AUTHENTICATION_API_KEY: "PON_AQUI_LA_MISMA_EVOLUTION_API_KEY_DEL_BOT"
      AUTHENTICATION_EXPOSE_KEY: "false"
      # El bot enviará este mismo valor como header `apikey` en cada llamada.
    depends_on: [redis, postgres]
  redis:
    image: redis:7-alpine
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: "evolution123"
      POSTGRES_DB: "evolution"
      POSTGRES_USER: "evolution"
    volumes: ["evo-pg:/var/lib/postgresql/data"]
volumes: { evo-pg: {} }
```

> Clave: `AUTHENTICATION_API_KEY` de Evolution **debe ser idéntico** a `EVOLUTION_API_KEY`
> del `.env` del bot. Así el bot puede crear instancias y enviar mensajes con su `apikey` global.

### 1.2 Crear las instancias y conectar los números (PASO HUMANO)
Por cada seccional:
1. En el panel del bot (`http://localhost:8090/admin` → pestaña **Líneas**) pulsas
   *Guardar línea* con `Seccional = FRESNO`, `Instancia = FRESNO`, etc.
   El bot llama `POST /instance/create` y `POST /webhook/set/FRESNO` en Evolution.
2. Obtienes el QR y lo escaneas con el WhatsApp del número de esa seccional:
   `GET http://<HOST_EVOLUTION>:8080/instance/qrcode/FRESNO` (o vía la UI de Evolution).
3. Verificas estado: panel *Líneas* → *Actualizar estado* debe decir `connected`.

Repite para las 9 seccionales. **El escaneo del QR es lo único que el bot no puede hacer.**

### 1.3 Apuntar el bot a Evolution
En `.env` del bot:
```
EVOLUTION_API_URL=http://<HOST_EVOLUTION>:8080
EVOLUTION_API_KEY=<LA_MISMA_KEY>
BOT_WEBHOOK_URL=http://<DONDE_EVOLUTION_ALCANZE_EL_BOT>/webhook/evolution
```

---

## 2. Drive vía rclone (SIN proyecto Google Cloud)

El bot ya **no** usa la API de Google ni cuentas de servicio. Escribe un único `.xlsx`
local y lo sincroniza con Drive con **rclone** (OAuth de cuenta Google personal/Workspace).
Esto evita crear un proyecto en Google Cloud (que tu admin de Workspace bloquea).

### 2.1 Instalar y configurar rclone (en el host donde corre el bot)
1. Instala rclone: https://rclone.org/install/ (en el server Ubuntu: `sudo apt install rclone`).
2. Crea el *remote* de Drive (modo headless en server sin navegador):
   ```bash
   rclone config
   # n: New remote -> nombre "drive"
   # Storage: Google Drive (drive)
   # client_id/client_secret: vacíos (usa los de rclone)
   # scope: drive (acceso a todo Drive)
   # En server sin navegador: elige "N" en "auto config" y pega la URL/token
   #   que genera rclone en tu PC con navegador, o usa `rclone author
   #   --drive-delete-shortcut-links=false` en tu PC y copia el token al server.
   ```
3. Prueba: `rclone lsd drive:elecciones` (debe listar tu carpeta).
4. Sube la plantilla a Drive una vez:
   ```bash
   rclone copyto "E:\jhonathan\Open\whatsapp-bot\3_PRECONTEO 2022-PLANCHAS.xlsx" \
                 "drive:elecciones/3_PRECONTEO 2022-PLANCHAS.xlsx"
   ```

### 2.2 Variables de entorno (`.env`)
```
SHEET_MODE=local
SHEET_LOCAL_PATH=/app/data/cache/3_PRECONTEO 2022-PLANCHAS.xlsx
RCLONE_REMOTE=drive:elecciones/3_PRECONTEO 2022-PLANCHAS.xlsx
```
- `RCLONE_REMOTE` vacío = modo local puro (el bot solo toca el archivo local; útil para
  pruebas en Docker Desktop sin Drive).
- En Windows/Docker Desktop puedes dejar `RCLONE_REMOTE=` y copiar la plantilla manualmente
  a la carpeta montada, o instalar rclone en Windows y apuntar a tu Drive.

### 2.3 Generar la plantilla con el catálogo COMPLETO de mesas
El archivo fuente de elecciones-fnc solo trae 323 mesas con `CÓDIGO MESA`. Para cubrir
**todas** las mesas del universo del app, genera la plantilla desde tu propio archivo de
catálogo (CSV, JSON o XLSX) con este script:

```powershell
# Columnas reconocidas (insensibles a mayúsculas/acentos/espacios):
#   codigo_mesa (requerido, numérico), seccional (requerido),
#   municipio_vota, municipio_ubicacion, ubicacion, departamento,
#   tipo_mesa, numero_mesa, estimado_votos_2022, circunscripcion
node scripts/importar-catalogo.js mi-catalogo-mesas.csv
# o desde JSON / XLSX:
node scripts/importar-catalogo.js mi-catalogo.json --out 3_PRECONTEO 2022-PLANCHAS.xlsx
```
El script crea las 6 hojas (`PRECONTEO`, `INSTALACION`, `PARTICIPACION`, `CONSOLIDADO`,
`SECCIONALES`, `HISTORIAL`) con **todas** las mesas codificadas. Luego sube ese archivo a
Drive (rclone) o súbelo por el panel (**Importar** adjuntando el archivo). El bot regenera
su catálogo interno (`config/mesas.json`) y los números de línea al importar.

---

## 3. Alimentar el catálogo + coordinadores (la plantilla)

La plantilla ya trae 1052 mesas. Tú debes dejar listos los coordinadores:

- **Opción A (panel, en caliente):** en `admin` → **Coordinadores** das de alta cada
  coordinador de mesa (código+municipio+nombre+contacto) y cada coordinador seccional.
  El bot escribe `PRECONTEO!Z/AA` y la hoja `SECCIONALES` en el `.xlsx` (y lo sube a Drive).
- **Opción B (Excel → Drive → importar):** editas las columnas `NOMBRE COORD MESA` /
  `CONTACTO COORD MESA` en PRECONTEO y la hoja `SECCIONALES` directamente en Google Sheets
  (web), luego en el panel → **Importar** pulsas *Importar desde Sheet* (el bot hace pull
  de Drive, reescribe el catálogo y los números de línea, y vuelve a subir).
- **Opción C (subir archivo):** en el panel → **Importar** adjuntas el `.xlsx` editado;
  el bot lo usa como nuevo archivo de trabajo y lo sube a Drive.

> El bot es **autónomo**: lee catálogo + coordinadores del `.xlsx` en cada arranque
> (`sheets.init()`). No depende del app elecciones-fnc. Los humanos pueden editar el mismo
> archivo en Google Sheets web; el bot hace pull antes de cada reporte para no pisar cambios.

---

## 4. Reconstruir el contenedor con las credenciales

Edita `.env` con todos los valores y recrea:
```powershell
cd E:\jhonathan\Open\whatsapp-bot
docker compose down
docker compose up -d
```
Verifica:
- `http://localhost:8090/health` → `healthy` y sin el warning de Sheets.
- En el log del contenedor debe aparecer *[sheets] local listo. PRECONTEO filas: … | coord mesa: … | coord seccional: …*.
- Panel → **Coordinadores** muestra los nombres/contactos leídos del Sheet.

---

## 5. Exponer el webhook para que Evolution te reach

Evolution debe poder hacer `POST` a `BOT_WEBHOOK_URL`. Elige según tu red:

- **Misma red/LAN:** usa la IP privada del host del bot, ej.
  `BOT_WEBHOOK_URL=http://192.168.1.50:8090/webhook/evolution`.
- **Evolution remoto / celular fuera de LAN:** necesitas URL pública. Opciones:
  - Tunelito (ngrok/cloudflared) temporal: `cloudflared tunnel --url http://localhost:8090`
    y usas la URL `https://xxxx.trycloudflare.com/webhook/evolution`.
  - Reverse proxy con dominio propio (nginx/Cloudflare) terminando TLS.

> El webhook solo necesita `POST /webhook/evolution` (Evolution manda `MESSAGES_UPSERT`).
> No expongas el panel `/admin` a internet sin autenticación/TLS.

---

## 6. Operación el día de la elección

- **Monitoreo:** panel → **Informes** (instaladas, 021, descuadres, alertas tempranas).
- **Número baneado/robado:** panel → **Líneas** → desmarca *Activa* o marca *Baneada*
  y cambia el número en Evolution (nueva instancia/QR). El bot rechaza la línea inactiva.
- **Cierre de jornada (opcional):** pon `CIERRE_HORARIO=17:00` en `.env` para que tras
  esa hora el bot informe que el reporte está cerrado.
- **Sin internet en el coordinador:** el app principal sigue siendo la vía principal;
  este bot es la vía de contingencia.

---

## 6b. Despliegue automatizado con `scripts/deploy.ps1`

El script diferencia dos entornos y no necesita CI (corres manualmente):

- **Dev (Docker Desktop = desarrollo/diagnóstico):**
  ```powershell
  .\scripts\deploy.ps1 -Environment Dev                 # build local + docker compose up (usa .env)
  .\scripts\deploy.ps1 -Environment Dev -Push           # igual, y además pushea la imagen a DockerHub
  ```
  Con `-Push` dejas `puntijhon/elecciones-bot:latest` lista para que el server de prod la jale.

- **Prod (Ubuntu server = producción):**
  ```powershell
  .\scripts\deploy.ps1 -Environment Prod                # build + push a DockerHub + SCP + SSH pull/up
  .\scripts\deploy.ps1 -Environment Prod -SkipBuild -SkipPush   # solo jalar y levantar en el server
  ```
  Requiere en `.env.deploy`: `DOCKERHUB_USER`, `DOCKERHUB_TOKEN`, `BOT_SSH_SERVER`,
  `BOT_SSH_PASS`, `BOT_SSH_HOSTKEY`, `BOT_SERVER_DIR`.
  Copia `.env.server.example` a `.env.server` con los valores de producción (incluye
  `SHEET_LOCAL_PATH` y `RCLONE_REMOTE`); el script lo SCPea al server junto con
  `docker-compose.prod.yml`. En el server, `rclone` debe estar configurado (ver §2.1).

> `docker-compose.prod.yml` usa la imagen de DockerHub (`puntijhon/elecciones-bot:latest`) y monta
> el volumen de caché del `.xlsx` y la config de rclone (`/root/.config/rclone`). El `.env` de prod
> debe apuntar `SHEET_MODE=local`, `SHEET_LOCAL_PATH=/app/data/cache/3_PRECONTEO 2022-PLANCHAS.xlsx`
> y `RCLONE_REMOTE=drive:elecciones/3_PRECONTEO 2022-PLANCHAS.xlsx`.

## 7. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `/health` muestra `coordMesa:0` y log *[sheets] local listo* con 0 | `SHEET_LOCAL_PATH` no apunta a la plantilla, o el archivo no tiene coordinadores | Revisa `.env`, `RCLONE_REMOTE` y que la plantilla tenga datos en PRECONTEO/SECCIONALES |
| Cambios no aparecen en Drive | `rclone` no instalado/configurado o `RCLONE_REMOTE` vacío | Verifica `rclone lsd <remote>`; el log avisará *rclone no disponible* |
| Evolution responde 401 al crear instancia | `EVOLUTION_API_KEY` ≠ `AUTHENTICATION_API_KEY` | Igualar ambas |
| Webhook no llega al bot | `BOT_WEBHOOK_URL` no alcanzable desde Evolution | Usa IP LAN o túnel público |
| Instancia `qrcode` vacío | Instancia ya conectada o nombre duplicado | Lista instancias en Evolution UI |
| Login admin falla tras recrear | El hash `$` en `.env` sin comillas | Usa `ADMIN_PASS_HASH='$2a$...'` |
