# Dockerfile — Bot de Contingencia WhatsApp → Google Sheets
FROM node:22-alpine

WORKDIR /app

# Dependencias primero (cache de capa)
COPY package.json package-lock.json* ./
# --ignore-scripts: el único binario precompilado viaja en el tarball de npm
RUN npm install --ignore-scripts

# Código fuente
COPY . .

ENV BOT_PORT=8090 \
    NODE_ENV=production

EXPOSE 8090

# El bot arranca aunque Sheets no esté disponible (modo degradado: panel + webhook)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8090/health || exit 1

CMD ["node", "src/index.js"]
