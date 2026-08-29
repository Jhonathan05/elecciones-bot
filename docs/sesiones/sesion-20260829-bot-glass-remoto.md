# Sesión 2026-08-29 — Bot de contingencia WhatsApp → Sheets (rclone local) + panel admin + push remoto

> Estado final: `main` == `origin/main` == `402ec2d`. Repo en https://github.com/Jhonathan05/elecciones-bot.git

## Objetivo
Canal de contingencia por WhatsApp (Evolution API, 1 instancia por seccional) que captura los 3 momentos de cada mesa (Instalación, Participación, Acta 021), valida por asignación de coordinador, y vuelca a **un único `.xlsx` en Google Drive** (fuente de verdad) editado también por humanos vía Google Sheets web. Sincronización vía `rclone` (sin proyecto Google Cloud). Panel web admin con CRUD coordinadores, importar/descargar, informes. Interfaz del panel rediseñada con el sistema de diseño institucional FNC.

## Decisiones
- **Backend local (`xlsx` + `rclone`)** en vez de Google Cloud (esquiva bloqueo `resourcemanager.projects.create`). El bot escribe SOLO celdas/filas de la mesa; humanos editan en Google Sheets web.
- **Catálogo:** el fuente solo trae **323 mesas con `CÓDIGO MESA`** (382 filas). Se aceptaron 323 por ahora. `scripts/importar-catalogo.js` regenera la plantilla con catálogo completo cuando el usuario aporte el archivo.
- **Credenciales admin:** `admin` / `admin`. En `.env`, `ADMIN_PASS_HASH` usa `$$2a$$08$$...` porque Docker `env_file` interpola `$`.
- **UI del panel:** reemplazado el Liquid Glass (refracción SVG, skill local) por el estilo del repo `appweb-skills-fnc` (`fnc-design-system` + `GlassModal`): glass con `backdrop-filter: blur`, tokens institucionales FNC (Tinto `#8d1024`, Verde `#1b502d`). El repo NO trae Liquid Glass; su "glass" es más simple.

## Trabajo completado
- `src/sheets.js`: backend local `xlsx`+`rclone` (mutex `withLock`, `syncPull`/`syncPush`, `headerMap`, `findRow`, `setCell` con fill, `appendHistorial`, `mapaVotos`, `consultarInformes`, `importarDesdeSheet`). Writers de instalación/participación/acta021/coordinadores. Google mode deprecado.
- `src/config.js`: `SHEET_MODE` (`local`), `SHEET_LOCAL_PATH`, `RCLONE_REMOTE`.
- `src/admin.js`: `multer` (`upload.single('archivo')`); `POST /admin/importar`; `GET /admin/descargar-trabajo`; `GET /admin/plantilla`.
- `package.json`: `xlsx ^0.18.5`, `multer ^2.0.1`.
- `scripts/importar-catalogo.js`: lee CSV/JSON/XLSX, mapea headers (normalizados), llama `buildWorkbook` de `scripts/build-template.js`.
- `docker-compose.yml` + `docker-compose.prod.yml`: volúmenes `bot-cache` (`/app/data/cache`) y `bot-rclone` (`/root/.config/rclone`).
- `scripts/deploy.ps1`: sin `BOT_GOOGLE_CREDS_LOCAL`; encabezado a modo local.
- `.env*`, `docs/`: modo local + rclone.
- `src/index.js`: `app.get('/')` redirige a `/admin`; log de arranque refleja modo.
- `public/admin.html`: rediseño con `fnc-design-system` (tokens FNC, `.glass`/`.card` blur 12px, overlay modal `blur(4px)`, caja tipo `GlassModal`, fuente Public Sans/Inter). Sin SVG/blobs.
- `.gitignore`: añadidos `*.xlsx`, `*.log`, `npm-debug.log`, `.DS_Store` (además de `node_modules/`, `data/`, `.env`, `*.db*`, `secrets/`, `logs/`).
- Contenedor `elecciones-bot` reconstruido y healthy; `/admin` sirve el panel con el nuevo estilo.

## Validación del repo `appweb-skills-fnc`
- Accesible (https://github.com/Jhonathan05/appweb-skills-fnc.git). Es catálogo de skills para la app principal (React/Next + Tailwind + FullCalendar), no para el bot (HTML/CSS vanilla).
- Skills relevantes: `fnc-design-system` (tokens HSL institucionales), `fnc-components/GlassModal.tsx` (modal vidrio), `modern-web-guidance` (herramienta `npx`), `VANGUARD_UX.md` (micro-interacciones).
- **Portable al bot:** tokens de color Tinto/Verde, `.glass`/`.card-premium`, `.modal-overlay blur(4px)`, GlassModal. **No portable:** `@import "tailwindcss"`, `@theme inline`, `dark:`, framer-motion (React). El repo no trae Liquid Glass SVG.
- Decisión del usuario: reemplazar el Liquid Glass propio por el glass del repo.

## Push remoto
- Repo del bot NO era git. `git init` + rama `main`.
- GitHub push protection bloqueó el primer push: `.env.deploy.example:3` contenía un **DockerHub PAT real** (`dckr_pat_...`). Se reemplazó por placeholder `dckr_pat_REEMPLAZAR_CON_TU_PAT` y se enmendó el commit. Recomendación: rotar el token en DockerHub.
- Push final exitoso: `* [new branch] main -> main`, tracking `origin/main`, commit `402ec2d`.
- Autenticación por HTTPS vía Git Credential Manager (funcionó en el segundo intento). Para futuros pushes usar PAT como contraseña.

## Next moves
1. (Usuario) Rotar el DockerHub PAT expuesto en el ejemplo.
2. (Usuario) En el server Ubuntu: `rclone config` apuntando a su Drive y fijar `RCLONE_REMOTE=drive:elecciones/3_PRECONTEO 2022-PLANCHAS.xlsx` en `.env.server`.
3. (Opcional) Cuando el usuario aporte el catálogo completo: `node scripts/importar-catalogo.js <archivo>` para cubrir >323 mesas.
4. (Opcional) Añadir micro-interacciones Vanguard (`.btn-shimmer`, skeleton) al panel si se desea.
