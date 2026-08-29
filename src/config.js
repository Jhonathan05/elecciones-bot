'use strict';
// config.js — carga de entorno y constantes del bot.
require('dotenv').config();
const path = require('path');

const env = process.env;

function bool(v, d = false) { return v ? v === 'true' || v === '1' : d; }

const CONFIG = {
  PORT: parseInt(env.BOT_PORT || '8090', 10),
  EVOLUTION_API_URL: env.EVOLUTION_API_URL || 'http://evolution-api:8080',
  EVOLUTION_API_KEY: env.EVOLUTION_API_KEY || '',
  BOT_WEBHOOK_URL: env.BOT_WEBHOOK_URL || 'http://bot:8090/webhook/evolution',
  GOOGLE_CREDENTIALS_JSON: env.GOOGLE_CREDENTIALS_JSON || '/app/secrets/google-service-account.json',
  GOOGLE_SHEET_ID: env.GOOGLE_SHEET_ID || '',
  SHEET_MODE: (env.SHEET_MODE || 'local').toLowerCase(),
  SHEET_LOCAL_PATH: env.SHEET_LOCAL_PATH || path.join(__dirname, '..', '3_PRECONTEO 2022-PLANCHAS.xlsx'),
  RCLONE_REMOTE: env.RCLONE_REMOTE || '',
  APP_MESAS_URL: env.APP_MESAS_URL || '',
  SECCIONALES_VALIDAS: (env.SECCIONALES_VALIDAS || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  CIERRE_HORARIO: env.CIERRE_HORARIO || '',
  ADMIN_USER: env.ADMIN_USER || 'admin',
  ADMIN_PASS_HASH: env.ADMIN_PASS_HASH || '',
  TOKEN_TTL_MS: 8 * 60 * 60 * 1000,
};

module.exports = { CONFIG, bool };
