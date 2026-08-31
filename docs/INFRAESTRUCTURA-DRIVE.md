# Arquitectura de Sincronización y Despliegue de Infraestructura (Ubuntu Server CLI & Google Drive)

Este documento describe la arquitectura de infraestructura, almacenamiento local y sincronización bidireccional entre el bot **elecciones-bot** (Docker) y **Google Drive** en un entorno de producción sobre **Ubuntu Server CLI**.

---

## 1. Visión General de la Infraestructura

```
                                  ENTORNO UBUNTU SERVER (CLI)
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                             │
 │   ┌─────────────────────────────┐           ┌───────────────────────────────────────────┐   │
 │   │  Contenedor elecciones-bot  │           │   Servicio RClone Daemon / Bisync Cron    │   │
 │   │         (Node.js 22)        │           │     (Proceso en segundo plano Ubuntu)     │   │
 │   └──────────────┬──────────────┘           └─────────────────────┬─────────────────────┘   │
 │                  │                                                │                         │
 │                  │ Volumen montado Docker                         │ Sincronización activa   │
 │                  ▼                                                ▼                         │
 │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
 │   │  Carpeta Local en Ubuntu: /var/elecciones/gdrive/                                   │   │
 │   │  📄 Archivo Sincronizado: 3_PRECONTEO 2022-PLANCHAS.xlsx                             │   │
 │   └─────────────────────────────────────────────────────────────────────────────────────┘   │
 └──────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                            │
                                            │ Sincronización Bidireccional (HTTPS/OAuth2)
                                            ▼
                               ┌───────────────────────────┐
                               │  Google Drive (Nube)      │
                               │  📁 Carpeta Compartida     │
                               └────────────┬──────────────┘
                                            │
                                            ▼
                               ┌───────────────────────────┐
                               │  Digitadores / Humanos    │
                               │  (Lectura / Escritura)    │
                               └───────────────────────────┘
```

---

## 2. Principios de Diseño

1. **Sin Permisos de Administrador de Workspace**:
   - No se requiere una cuenta de Google Workspace con permisos administrativos ni cuentas de servicio con delegación de dominio.
   - Funciona mediante una carpeta estándar compartida en Google Drive usando **RClone** con credenciales OAuth2 de usuario.

2. **Rendimiento y Respuesta WhatsApp Ultra Rápida**:
   - El bot de Node.js interactúa **exclusivamente con el sistema de archivos local** de Ubuntu Server (vía volumen Docker `/app/shared/3_PRECONTEO 2022-PLANCHAS.xlsx`).
   - Esto garantiza tiempos de respuesta `< 100ms` a los mensajes de los coordinadores en WhatsApp sin depender de latencias de API de red para cada mensaje.

3. **Sincronización Bidireccional y Resiliencia**:
   - **Bot → Drive**: Al confirmar un reporte por WhatsApp o guardar coordinadores, el bot modifica la copia local y ejecuta la sincronización hacia Drive.
   - **Drive → Bot**: Los cambios hechos por digitadores humanos en Google Drive son sincronizados hacia la carpeta de Ubuntu.
   - **Tolerancia a fallos de red**: Si el servidor pierde la conexión a internet temporalmente, los reportes se acumulan de forma segura en el archivo local de Ubuntu y se sincronizan automáticamente cuando la conexión se restablece.

---

## 3. Guía de Configuración en Ubuntu Server CLI

### Paso A: Instalación de RClone
```bash
sudo apt update && sudo apt install -y rclone
```

### Paso B: Configuración del Remote de Google Drive
```bash
rclone config
```
1. Presiona `n` para crear un **New remote**.
2. Nombre: `gdrive`.
3. Selecciona la opción **Google Drive**.
4. Deja en blanco los campos de `client_id` y `client_secret` (usar valores por defecto de RClone) o proporciona los tuyos.
5. Scope: Selecciona `1` (`drive` — acceso completo).
6. Cuando pregunte **Use auto config?**, responde `N` (ya que estás en Ubuntu Server CLI sin navegador).
7. Copia el comando que te brinda RClone en tu máquina local con navegador para autorizar la cuenta y pega la clave de verificación devuelta.

### Paso C: Crear directorio de almacenamiento local
```bash
sudo mkdir -p /var/elecciones/gdrive
sudo chown -R $USER:$USER /var/elecciones/gdrive
```

### Paso D: Configurar Sincronización Automática (Cron / Systemd)
Para mantener la sincronización continua entre la carpeta local de Ubuntu y Google Drive, agrega una tarea periódica en el `crontab`:

```bash
crontab -e
```
Agrega la siguiente línea (ejecución cada minuto):
```cron
* * * * * rclone bisync gdrive:Elecciones2026 /var/elecciones/gdrive --resync-mode touch --quiet
```

---

## 4. Integración con Docker y Variables de Entorno

### `docker-compose.yml`
```yaml
services:
  bot:
    build: .
    image: elecciones-bot:latest
    container_name: elecciones-bot
    ports:
      - "8090:8090"
    env_file:
      - .env
    volumes:
      - bot-data:/app/data
      - /var/elecciones/gdrive:/app/shared
    networks:
      - infra-net
    restart: unless-stopped

networks:
  infra-net:
    external: true
```

### `.env`
```env
SHEET_MODE=local
SHEET_LOCAL_PATH=/app/shared/3_PRECONTEO 2022-PLANCHAS.xlsx
RCLONE_REMOTE=gdrive:Elecciones2026/3_PRECONTEO 2022-PLANCHAS.xlsx
```

---

## 5. Ajuste Dinámico de Rutas desde el Panel de Administración

El sistema permite consultar y actualizar las rutas de almacenamiento local (`SHEET_LOCAL_PATH`) y remoto (`RCLONE_REMOTE`) en caliente desde el panel web de administración (`/admin/ui/admin.html`), modificando el destino activo sin requerir reinicio del proceso.
