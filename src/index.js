'use strict';
// index.js — servidor del bot: webhook de Evolution + panel admin + health.
const express = require('express');
const path = require('path');
const { CONFIG } = require('./config');
const state = require('./state');
const maestro = require('./maestro');
const flows = require('./flows');
const evo = require('./evolution');
const admin = require('./admin');
let sheets = require('./sheets');

const app = express();
app.use(express.json());

// ---- Cierre de jornada ----
function isCerrado() {
  if (!CONFIG.CIERRE_HORARIO) return false;
  const ahora = new Date();
  const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  return hhmm >= CONFIG.CIERRE_HORARIO;
}

// ---- Contexto de conversación (inyectado a flows) ----
function getSeccionalDeInstancia(instance) {
  const l = state.getLineaPorInstance(instance);
  if (!l || !l.enabled || l.banned) return null;
  return l.seccional;
}

function makeCtx(phone, instance) {
  return {
    getSession: state.getSession,
    saveSession: state.saveSession,
    clearSession: state.clearSession,
    getSeccionalDeInstancia,
    isCerrado,
    maestro,
    linea: instance,
    telefono: phone,
    sheets: {
      escribirInstalacion: (m, s, mun, d, ctx2) => sheets.escribirInstalacion(m, s, mun, d, ctx2),
      escribirParticipacion: (m, s, mun, b, ctx2) => sheets.escribirParticipacion(m, s, mun, b, ctx2),
      escribirActa021: (m, s, mun, d, ctx2) => sheets.escribirActa021(m, s, mun, d, ctx2),
    },
    logger: console,
  };
}

// Cache de deduplicación de mensajes (expira en 2 minutos)
const processedMsgs = new Set();

// ---- Webhook de Evolution ----
app.post('/webhook/evolution', async (req, res) => {
  try {
    const body = req.body || {};
    const evt = String(body.event || '').toUpperCase().replace('.', '_');
    if (evt !== 'MESSAGES_UPSERT') return res.json({ ok: true, ignored: true });
    const instance = body.instance;
    const data = body.data;
    if (!data || !data.key || data.key.fromMe) return res.json({ ok: true, ignored: true });
    
    // Deduplicación por ID de mensaje
    const msgId = data.key.id;
    if (msgId) {
      if (processedMsgs.has(msgId)) {
        return res.json({ ok: true, duplicated: true });
      }
      processedMsgs.add(msgId);
      setTimeout(() => processedMsgs.delete(msgId), 120000);
    }
    
    console.log('[WEBHOOK INCOMING]', JSON.stringify({ instance, key: data.key, pushName: data.pushName, msg: data.message }));

    const remoteJid = data.key.remoteJid;
    const msg = data.message || {};
    const text = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
      (msg.imageMessage && msg.imageMessage.caption) || '';
    if (!text) return res.json({ ok: true, ignored: true });
    
    const phone = await evo.resolveRealPhone(instance, remoteJid);
    console.log('[WEBHOOK PROCESSED]', { remoteJid, resolvedPhone: phone, text });
    const seccional = getSeccionalDeInstancia(instance);
    if (!seccional) {
      await evo.sendText(instance, remoteJid, '⛔ Esta línea no está activa para reporte. Contacta al administrador.').catch(() => {});
      return res.json({ ok: true });
    }
    const ctx = makeCtx(phone, instance);
    const reply = await flows.handle(phone, text, ctx, instance);
    console.log('[WEBHOOK REPLY TO]', remoteJid, 'REPLY:', reply);
    await evo.sendText(instance, remoteJid, reply);
    res.json({ ok: true });
  } catch (e) {
    console.error('webhook error', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- Panel admin + UI ----
app.use('/admin', admin.router);
app.use('/admin/ui', express.static(path.join(__dirname, '..', 'public')));
app.get('/admin', (req, res) => res.redirect('/admin/ui/admin.html'));
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/health', (req, res) => res.json({ status: 'healthy', cerrado: isCerrado(), seccionales: maestro._estado() }));

async function main() {
  maestro.cargar();
  // sembrar admin desde CONFIG
  if (CONFIG.ADMIN_PASS_HASH) state.setAdmin(CONFIG.ADMIN_USER, CONFIG.ADMIN_PASS_HASH);
  // intentar init de Sheets (puede fallar sin credenciales en dev)
  try {
    await sheets.init();
    maestro.setCoordinadores(sheets.getCoordinadores());
    const modo = CONFIG.SHEET_MODE === 'google' ? 'Google Sheets' : `archivo local (${CONFIG.SHEET_LOCAL_PATH})${CONFIG.RCLONE_REMOTE ? ' + rclone' : ''}`;
    console.log(`Almacenamiento listo [${modo}] y coordinadores cargados.`);
  }
  catch (e) { console.warn('Sheets no disponible (modo degradado):', e.message); }
  // refresco opcional del maestro desde el app
  if (CONFIG.APP_MESAS_URL) {
    setInterval(() => { /* aquí se podría refrescar maestro vía HTTP */ }, 15 * 60 * 1000);
  }
  app.listen(CONFIG.PORT, () => console.log(`Bot escuchando en :${CONFIG.PORT} (admin /admin/ui, webhook /webhook/evolution)`));
}

main();
