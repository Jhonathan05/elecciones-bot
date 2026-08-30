#!/bin/bash
# scripts/setup-evolution.sh
# Configuración automática de Evolution API

set -euo pipefail

API_KEY="${EVOLUTION_API_KEY}"
INSTANCE="chaparral"
WEBHOOK_URL="${BOT_WEBHOOK_URL:-http://elecciones-bot:8090/webhook/evolution}"
EVOLUTION_URL="http://localhost:8080"

wait_for_evolution() {
    echo "Esperando Evolution API..."
    for i in {1..30}; do
        if curl -sf "http://localhost:8080/manager/health" >/dev/null; then
            echo "Evolution API lista"
            return 0
        fi
        sleep 2
    done
    echo "Timeout esperando Evolution API"
    exit 1
}

create_instance() {
    echo "Creando instance 'chaparral'..."
    curl -s -X POST "http://localhost:8080/instance/create" \
        -H "Content-Type: application/json" \
        -H "apikey: ${EVOLUTION_API_KEY}" \
        -d '{
            "instanceName": "chaparral",
            "qrcode": true,
            "integration": "WHATSAPP-BAILEYS",
            "rejectCall": true,
            "alwaysOnline": true,
            "readMessages": true,
            "readStatus": true
        }' | jq .
}

setup_webhook() {
    echo "Configurando webhook..."
    curl -s -X POST "http://localhost:8080/webhook/set/chaparral" \
        -H "Content-Type: application/json" \
        -H "apikey: ${EVOLUTION_API_KEY}" \
        -d "{
            \"url\": \"${WEBHOOK_URL}\",
            \"webhook_by_events\": false,
            \"events\": [\"MESSAGES_UPSERT\"]
        }" | jq .
}

check_connection() {
    echo "Verificando estado de conexión..."
    curl -s "http://localhost:8080/instance/connectionState/chaparral" \
        -H "apikey: ${EVOLUTION_API_KEY}" | jq .
}

main() {
    echo "=== Configurando Evolution API ==="
    wait_for_evolution
    create_instance
    setup_webhook
    check_connection
    echo "=== Evolution API configurada ==="
    echo "Escanea el QR en http://<IP>:8080/manager con el celular de la seccional"
}

main "$@"