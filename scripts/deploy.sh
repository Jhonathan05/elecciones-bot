#!/bin/bash
# scripts/deploy.sh
# Deploy automatizado a producción

set -euo pipefail

# Configuración
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE=".env.production"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_prerequisites() {
    log "Verificando prerequisitos..."
    command -v docker >/dev/null || { error "Docker no instalado"; exit 1; }
    command -v docker-compose >/dev/null || { error "Docker Compose no instalado"; exit 1; }
    [[ -f ".env.production" ]] || { error "Falta .env.production"; exit 1; }
    log "Prerequisitos OK"
}

backup_data() {
    log "Creando backup..."
    local backup_dir="/opt/backups/elecciones-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    docker exec elecciones-bot tar czf - -C /app data 2>/dev/null | tar xzf - -C "$backup_dir"
    log "Backup en $backup_dir"
}

deploy() {
    log "Iniciando despliegue..."
    
    cd "$PROJECT_ROOT/docker"
    
    # Pull latest images
    log "Descargando imágenes..."
    docker compose -f docker-compose.prod.yml pull
    
    # Build bot
    log "Construyendo imagen del bot..."
    docker compose -f docker-compose.prod.yml build bot
    
    # Start services
    log "Iniciando servicios..."
    docker compose -f docker-compose.prod.yml up -d --remove-orphans
    
    # Wait for health
    log "Esperando health checks..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.Status}}" | grep -q "healthy"; then
            log "Servicios healthy"
            break
        fi
        sleep 2
        ((retries--))
    done
    
    if [[ $retries -eq 0 ]]; then
        error "Timeout esperando health checks"
        docker compose -f docker-compose.prod.yml logs --tail=50
        exit 1
    fi
    
    log "Despliegue completado exitosamente"
}

run_migrations() {
    log "Ejecutando migraciones (si las hay)..."
    # docker exec elecciones-bot node scripts/migrate.js
}

health_check() {
    log "Verificando health endpoints..."
    local endpoints=("http://localhost/health" "http://localhost/evolution/manager/health")
    for ep in "${endpoints[@]}"; do
        if curl -sf "$ep" >/dev/null; then
            log "✓ $ep"
        else
            warn "✗ $ep no responde"
        fi
    done
}

cleanup() {
    log "Limpiando imágenes no usadas..."
    docker image prune -f --filter "until=24h"
}

main() {
    log "=== Despliegue Producción Elecciones Bot ==="
    check_prerequisites
    backup_data
    deploy
    health_check
    cleanup
    log "=== Despliegue completado ==="
}

main "$@"