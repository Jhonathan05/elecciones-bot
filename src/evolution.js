'use strict';
// evolution.js — cliente HTTP de Evolution API (instancias múltiples en un solo contenedor).
const { CONFIG } = require('./config');

const BASE = CONFIG.EVOLUTION_API_URL.replace(/\/$/, '');
const KEY = CONFIG.EVOLUTION_API_KEY;

function headers() {
  return { 'Content-Type': 'application/json', apikey: KEY };
}

async function request(method, path, body, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

function extraerNumero(keyObj) {
  if (typeof keyObj === 'string') {
    return String(keyObj).split('@')[0];
  }
  if (!keyObj) return '';
  const alt = keyObj.remoteJidAlt || keyObj.participantAlt || keyObj.participant || keyObj.remoteJid || '';
  if (String(alt).includes('@s.whatsapp.net') || String(alt).includes('@c.us')) {
    return String(alt).split('@')[0];
  }
  return String(keyObj.remoteJid || '').split('@')[0];
}

async function sendText(instance, numeroOjid, message) {
  // Si viene con @lid o @s.whatsapp.net se pasa tal cual en remoteJid / number
  const target = String(numeroOjid || '');
  const body = target.includes('@') ? { number: target } : { number: target };
  return request('POST', `/message/sendText/${instance}`, { number: target, text: message });
}

async function listInstances() {
  return request('GET', '/instance/fetchInstances');
}

async function createInstance(instance) {
  const res = await request('POST', '/instance/create', { instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  try {
    await connectInstance(instance);
  } catch (e) {}
  return res;
}

async function connectInstance(instance) {
  return request('GET', `/instance/connect/${instance}`, undefined, 15000);
}

async function deleteInstance(instance) {
  return request('DELETE', `/instance/delete/${instance}`, undefined, 5000);
}

async function logoutInstance(instance) {
  return request('DELETE', `/instance/logout/${instance}`, undefined, 5000);
}

async function setWebhook(instance, url) {
  return request('POST', `/webhook/set/${instance}`, {
    webhook: {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT'],
    },
  });
}

async function getInstanceStatus(instance) {
  try {
    const r = await request('GET', `/instance/connectionState/${instance}`, undefined, 5000);
    const stateVal = r.instance ? r.instance.state : (r.state || r);
    if (stateVal === 'open') {
      return { instance, state: 'open' };
    }
    // Para connecting/close/qrcode: pedir QR directamente
    if (stateVal === 'connecting' || stateVal === 'qrcode' || stateVal === 'close') {
      try {
        const conn = await connectInstance(instance);
        if (conn && conn.base64) {
          return { instance, state: 'qrcode', qrcode: conn.base64 };
        }
      } catch (e) {}
    }
    return { instance, state: stateVal };
  } catch (e) {
    if (e.status === 404) {
      try {
        const conn = await connectInstance(instance);
        if (conn && conn.base64) {
          return { instance, state: 'qrcode', qrcode: conn.base64 };
        }
        return { instance, state: 'connecting' };
      } catch (err) {
        return { instance, state: 'error', error: err.message };
      }
    }
    return { instance, state: 'error', error: e.message };
  }
}

async function resolveRealPhone(instance, remoteJid) {
  if (!remoteJid) return '';
  const str = String(remoteJid);
  if (!str.includes('@lid')) {
    return str.split('@')[0];
  }
  try {
    const res = await request('POST', `/chat/findContacts/${instance}`, { where: { id: str } }, 4000);
    if (Array.isArray(res) && res[0] && res[0].id && !res[0].id.includes('@lid')) {
      return res[0].id.split('@')[0];
    }
  } catch (e) {}
  return str.split('@')[0];
}

module.exports = { sendText, listInstances, createInstance, connectInstance, deleteInstance, logoutInstance, setWebhook, getInstanceStatus, extraerNumero, resolveRealPhone, BASE };
