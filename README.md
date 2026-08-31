# Bot de Contingencia Electoral WhatsApp → Google Drive / Excel

Sistema de contingencia para recolección de datos electorales en tiempo real mediante **WhatsApp** (Evolution API) y sincronización continua con **Google Drive / Excel local**.

Permite gestionar los 3 momentos del día de las elecciones:
1. 1️⃣ **Instalación de la Mesa** (Jurados, Kit electoral, Sillas, Mesa física).
2. 2️⃣ **Participación** (Boletines B1, B2, B3).
3. 3️⃣ **Preconteo (Acta 021)** (Votos por plancha 1 a 5, Blanco, Nulos, No marcados, Incinerados y Alertas de Cuadre).

---

## 🏗️ Arquitectura del Sistema

- **Evolution API (Docker)**: Gestiona las instancias de WhatsApp vinculadas por código QR.
- **Bot Container (Node.js 22)**: Procesa la lógica conversacional interactiva por números, efectúa validaciones, administra el panel de control y sincroniza datos.
- **Base de Datos SQLite (`data/bot.db`)**: Mantiene el estado en caliente de coordinadores, mapeo de WhatsApp Privacy `@lid` y asignación de líneas.
- **Almacenamiento Local Sincronizado**: Lee y escribe instantáneamente en `/app/shared/3_PRECONTEO 2022-PLANCHAS.xlsx`.
- **RClone Daemon / Google Drive Desktop**: Mantiene sincronizada la carpeta local del servidor con Google Drive en tiempo real.

---

## 🚀 Guía de Despliegue Impecable desde Cero

### 1. Requisitos Previos
- Docker Engine y Docker Compose instalados.
- Red de Docker externa creada:
  ```bash
  docker network create infra-net
  ```

### 2. Clonar Repositorio y Configurar Entorno
```bash
git clone https://github.com/Jhonathan05/elecciones-bot.git
cd elecciones-bot
cp .env.example .env
```

Edita `.env` definiendo tus variables de entorno:
```env
BOT_PORT=8090
ADMIN_USER=admin
# Generar hash con: node -e "console.log(require('bcryptjs').hashSync('TU_PASSWORD',8))"
ADMIN_PASS_HASH='$2a$08$...'

EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=tu_api_key_aqui
BOT_WEBHOOK_URL=http://tu-servidor:8090/webhook/evolution

SHEET_MODE=local
SHEET_LOCAL_PATH=/app/shared/3_PRECONTEO 2022-PLANCHAS.xlsx
RCLONE_REMOTE=gdrive:Elecciones2026/3_PRECONTEO 2022-PLANCHAS.xlsx
```

### 3. Crear Estructura de Volúmenes Locales
```bash
sudo mkdir -p /var/elecciones/gdrive
sudo chown -R $USER:$USER /var/elecciones/gdrive
```

### 4. Desplegar los Contenedores
Usando las imágenes publicadas en **Docker Hub**:
```bash
docker compose up -d
```

O si deseas desplegar la pila completa con **Evolution API**:
```bash
docker compose -f docker-compose.yml -f docker/docker-compose.evolution.yml up -d
```

### 5. Acceder al Panel de Administración Web
Ingresa en tu navegador a:
```text
http://TU_IP_SERVIDOR:8090/admin/ui/admin.html
```

---

## 📄 Guía de Infraestructura y Sincronización
Para más detalles técnicos sobre cómo configurar RClone en un servidor **Ubuntu Server CLI** sin permisos de administrador de Workspace, consulta la guía dedicada:
👉 [docs/INFRAESTRUCTURA-DRIVE.md](docs/INFRAESTRUCTURA-DRIVE.md)

---

## 🧪 Comprobación y Tests de Lógica
Para ejecutar los tests automatizados de validaciones y flujos sin dependencias externas:
```bash
docker exec elecciones-bot npm run test:logic
```

---

## 🔒 Control de Seguridad y Fraude (v0.3.0)
- **Autenticación por Whitelist**: Solo los números de teléfono registrados como Coordinadores Seccionales o Coordinadores de Mesa pueden iniciar la interacción.
- **Vínculo Automático Privacy ID (`@lid`)**: Sincroniza automáticamente los números privados de usuarios iPhone/WhatsApp Business con la seccional correspondiente y los persiste en SQLite (`lid_mappings`).
- **Validación de Respuestas Guiadas por Número**: Los menús operan con opciones numéricas (`1`, `2`) evitando fallos tipográficos.
- **Verificación previa a Diligenciamiento**: Muestra nombre del coordinador, seccional, municipio y ubicación de mesa para confirmación previa antes de capturar votos.
- **Control de Desajuste de Seccional**: Alerta y guía al usuario si escribe a la línea de una seccional distinta a la asignada.
- **Auto-selección para Coordinador de Mesa Única**: Agiliza el flujo para los coordinadores con una sola mesa asignada saltando la solicitud del código y yendo directo a la confirmación de datos.

---

## ⚡ Novedades y Mejoras de la Versión 0.3.0

1. 📊 **Tablero Semáforo en Vivo (Dashboard Web)**:
   - Panel visual con métricas de mesas instaladas, total de sufragantes acumulados, actas transmitidas y alertas matemáticas de descuadre.
   - Filtros dinámicos por seccional, estado operativo (`PENDIENTE`, `EN_PROCESO`, `COMPLETO`, `DESCUADRE`) y búsqueda instantánea.

2. 🛡️ **Failover en Caliente de Líneas (Hot-Standby)**:
   - Soporte para 2 líneas de respaldo pre-vinculadas (`RESPALDO_1`, `RESPALDO_2`).
   - Si una línea oficial de cualquier seccional se bloquea o desconecta, el administrador puede conmutarla a una línea de respaldo en **1 clic** desde el panel web sin perder sesiones ni reconfigurar nada.
   - Botón de **Restaurar Línea Oficial** una vez restablecido el número principal.

3. 📸 **Auditoría con Evidencia Fotográfica de Acta 021 (E-14)**:
   - Al finalizar el preconteo numérico, el coordinador puede enviar opcionalmente una foto del formulario físico de su Acta 021.
   - El bot descarga y archiva la foto en `/app/data/evidencias/` con registro en SQLite y galería de auditoría con zoom en el panel web.

4. 📱 **Comando `ESTADO` / `RESUMEN` y Comprobante Oficial de Radicación**:
   - Los coordinadores pueden consultar en cualquier momento el estado de sus mesas asignadas escribiendo `ESTADO` o `RESUMEN`.
   - Al confirmar el Acta 021, el bot emite un **Comprobante Digital Oficial** con formato formal y código de radicado único generado mediante hash (`REC-SEC-MESA-HASH`).

5. 💾 **Backups Automáticos en Caliente cada 15 Minutos**:
   - Servicio periódico en segundo plano que genera snapshots con timestamp de `3_PRECONTEO 2022-PLANCHAS.xlsx` y `bot-state.db`.
   - Rotación automática de los últimos 50 archivos y descarga directa desde el panel web.

---

## 🛠️ Solución de Problemas Frecuentes (Troubleshooting)

### 1. Error *"No se pudo vincular el dispositivo. Vuelve a intentarlo más tarde"* en WhatsApp Business
* **Causa:** Restricción temporal de Meta (soft-ban) por múltiples intentos o versión beta de la app móvil.
* **Solución:**
  1. Asegúrate de que la app móvil de WhatsApp Business no esté en programa Beta y esté actualizada.
  2. Si persiste, usa un WhatsApp estándar temporalmente o espera 12-24h para que Meta libere la restricción del número.

### 2. Mensaje *"Este número no está autorizado para reportar"* en iPhone
* **Causa:** En iPhone, WhatsApp enmascara el número telefónico detrás de un `@lid` privado.
* **Solución:** Al primer mensaje, el bot le preguntará automáticamente su número de celular (`3109876543`). Una vez ingresado y validado contra el catálogo, el bot lo vinculará permanentemente en SQLite sin necesidad de intervención manual.

### 3. Limpieza completa de sesiones y bases de datos
Para reiniciar el entorno por completo y eliminar cualquier sesión corrupta de Postgres/Redis/SQLite:
```bash
docker compose -f docker-compose.yml -f docker/docker-compose.evolution.yml down -v
docker compose -f docker-compose.yml -f docker/docker-compose.evolution.yml up -d
```
