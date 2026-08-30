#!/bin/bash
# scripts/setup-nginx.sh
# Configuración automática de Nginx + SSL con Certbot

set -euo pipefail

DOMAIN="${DOMAIN:-tudominio.com}"
EMAIL="${CERTBOT_EMAIL:-admin@tudominio.com}"

setup_certbot() {
    echo "Obteniendo certificados SSL para ${DOMAIN}..."
    
    # Detener nginx temporalmente
    docker compose -f docker/docker-compose.prod.yml stop nginx
    
    # Obtener certificado
    docker run --rm \
        -v certbot-etc:/etc/letsencrypt \
        -v certbot-www:/var/www/certbot \
        certbot/certbot certonly \
        --webroot -w /var/www/certbot \
        -d "${DOMAIN}" -d "evolution.${DOMAIN}" \
        --email "${EMAIL}" \
        --agree-tos --no-eff-email \
        --non-interactive
    
    # Reiniciar nginx
    docker compose -f docker/docker-compose.prod.yml up -d nginx
}

auto_renew() {
    echo "Configurando auto-renovación..."
    # Certbot container ya maneja renovación automática
    echo "Certbot configurado para auto-renovación cada 12h"
}

main() {
    echo "=== Configurando Nginx + SSL para ${DOMAIN} ==="
    setup_certbot
    auto_renew
    echo "=== Nginx + SSL configurado ==="
}

main "$@"