'use strict';
// evolution.js — cliente HTTP de Evolution API (instancias múltiples en un solo contenedor).
const { CONFIG } = require('./config');

const BASE = CONFIG.EVOLUTION_API_URL.replace(/\/$/, '');
const KEY = CONFIG.EVOLUTION_API_KEY;

function headers() {
  return { 'Content-Type': 'application/json', apikey: KEY };
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json;
  try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  if (!res.ok) {
    const err = new Error('Evolution ' + method + ' ' + path + ' -> ' + res.status + ' ' + txt);
    err.status = res.status;
    throw err;
  }
  return json;
}

function extraerNumero(remoteJid) {
  // 573001234567@c.us -> 573001234567
  return String(remoteJid || '').split('@')[0];
}

async function sendText(instance, numero, message) {
  return request('POST', `/message/sendText/${instance}`, { number: numero, text: message });
}

async function listInstances() {
  return request('GET', '/instance/fetchInstances');
}

async function createInstance(instance) {
  return request('POST', '/instance/create', { instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
}

async function setWebhook(instance, url) {
  return request('POST', `/webhook/set/${instance}`, {
    url,
    webhook_by_events: false,
    webhook_base64: false,
    events: ['MESSAGES_UPSERT'],
  });
}

async function getInstanceStatus(instance) {
  try {
    const r = await request('GET', `/instance/connectionState/${instance}`);
    return r;
  } catch (e) {
    return { instance, state: 'error', error: e.message };
  }
}

module.exports = { sendText, listInstances, createInstance, setWebhook, getInstanceStatus, extraerNumero, BASE };
