# scripts/deploy.ps1 — build + (opcional push a DockerHub) + deploy Dev (Docker Desktop) o Prod (Ubuntu server)
# Modo de almacenamiento: LOCAL (xlsx + rclone). No requiere credenciales de Google.
param(
  [ValidateSet('Dev', 'Prod')] [string] $Environment,
  [switch] $SkipBuild,
  [switch] $Push,
  [switch] $SkipPush
)

if (-not $Environment) { throw 'Usa -Environment Dev o -Environment Prod' }
$ErrorActionPreference = 'Stop'

function Load-Env([string]$file) {
  if (-not (Test-Path $file)) { return }
  Get-Content $file | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $k = $matches[1]; $v = $matches[2].Trim()
      if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
      if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
      if (-not (Test-Path "env:$k")) { Set-Item "env:$k" $v }
    }
  }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = Split-Path -Parent $root
Load-Env (Join-Path $root '.env.deploy')
Load-Env (Join-Path $root '.env')

$IMAGE = if ($env:BOT_IMAGE) { $env:BOT_IMAGE } else { 'puntijhon/elecciones-bot' }
$STAMP = Get-Date -Format 'yyyyMMddHHmm'
$TAG = "v$STAMP"
$PLINK = 'C:\Program Files\PuTTY\plink.exe'
$PSCP = 'C:\Program Files\PuTTY\pscp.exe'

$SERVER = $env:BOT_SSH_SERVER
$USER = if ($env:BOT_SSH_USER) { $env:BOT_SSH_USER } else { 'root' }
$PASS = $env:BOT_SSH_PASS
$HOSTKEY = $env:BOT_SSH_HOSTKEY
$SERVER_DIR = if ($env:BOT_SERVER_DIR) { $env:BOT_SERVER_DIR } else { '/opt/elecciones-bot' }
$REMOTE_ENV = if ($env:BOT_SERVER_ENV) { $env:BOT_SERVER_ENV } else { (Join-Path $root '.env.server') }

if (-not $SkipBuild) {
  Write-Host "==> Build de imagen"
  docker compose -f (Join-Path $root 'docker-compose.yml') build
}

docker tag "elecciones-bot:latest" "${IMAGE}:latest"
docker tag "elecciones-bot:latest" "${IMAGE}:${TAG}"

function Push-Image {
  if (-not $env:DOCKERHUB_USER -or -not $env:DOCKERHUB_TOKEN) {
    throw 'Faltan DOCKERHUB_USER / DOCKERHUB_TOKEN en .env.deploy'
  }
  Write-Host "==> Login y push a DockerHub ($IMAGE)"
  $env:DOCKERHUB_TOKEN | docker login -u $env:DOCKERHUB_USER --password-stdin
  docker push "${IMAGE}:latest"
  docker push "${IMAGE}:${TAG}"
}

if ($Environment -eq 'Dev') {
  Write-Host "==> Deploy DEV (Docker Desktop) con docker-compose.yml"
  docker compose -f (Join-Path $root 'docker-compose.yml') up -d
  if ($Push) { Push-Image }
}

if ($Environment -eq 'Prod') {
  if (-not $SkipPush) { Push-Image }
  if (-not $SERVER -or -not $PASS) { throw 'Faltan BOT_SSH_SERVER / BOT_SSH_PASS en .env.deploy' }
  Write-Host "==> Deploy PROD -> ${USER}@${SERVER}:${SERVER_DIR}"
  & $PLINK -pw $PASS -hostkey $HOSTKEY "${USER}@${SERVER}" "mkdir -p ${SERVER_DIR}/secrets"
  & $PSCP -pw $PASS -hostkey $HOSTKEY (Join-Path $root 'docker-compose.prod.yml') "${USER}@${SERVER}:${SERVER_DIR}/docker-compose.prod.yml"
  if (Test-Path $REMOTE_ENV) {
    & $PSCP -pw $PASS -hostkey $HOSTKEY (Resolve-Path $REMOTE_ENV).Path "${USER}@${SERVER}:${SERVER_DIR}/.env"
  }
  & $PLINK -pw $PASS -hostkey $HOSTKEY "${USER}@${SERVER}" "cd ${SERVER_DIR} && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
}

Write-Host "==> Listo. Entorno: $Environment | Imagen: ${IMAGE}:${TAG}"
