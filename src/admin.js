'use strict';
// admin.js — panel web de administración (auth propia del bot):
// - reasignar números por seccional (líneas)
// - CRUD de coordinadores (mesa / seccional) en caliente
// - importar catálogo + líneas desde el Sheet
// - descargar plantilla Excel
// - informes y alertas tempranas
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const state = require('./state');
const evo = require('./evolution');
const sheets = require('./sheets');
const maestro = require('./maestro');

const SECRET = process.env.ADMIN_SECRET || require('./config').CONFIG.EVOLUTION_API_KEY || 'cambia-secret';

function sign(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  return `${p}.${sig}`;
}
function verify(token) {
  try {
    const [p, sig] = token.split('.');
    const ok = crypto.createHmac('sha256', SECRET).update(p).digest('base64url') === sig;
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function autenticar(user, pass) {
  const admin = state.getAdmin(user) || (user === require('./config').CONFIG.ADMIN_USER && require('./config').CONFIG.ADMIN_PASS_HASH
    ? { user, pass_hash: require('./config').CONFIG.ADMIN_PASS_HASH } : null);
  if (!admin) return false;
  return bcrypt.compareSync(pass, admin.pass_hash);
}

function requireAuth(req, res, next) {
  const t = req.headers['x-admin-token'] || (req.body && req.body.token) || (req.query.token);
  const payload = t && verify(t);
  if (!payload) return res.status(401).json({ error: 'No autenticado' });
  req.admin = payload;
  next();
}

function reloadCoordinadores() {
  maestro.setCoordinadores(sheets.getCoordinadores());
}

const router = express.Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'bot-uploads') });

router.post('/login', (req, res) => {
  const { user, password } = req.body || {};
  if (!autenticar(user, password)) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = sign({ user, exp: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ ok: true, token });
});

// ---------- Líneas (números por seccional) ----------
router.get('/lineas', requireAuth, (req, res) => res.json({ lineas: state.listLineas() }));

router.get('/lineas/estado', requireAuth, async (req, res) => {
  const lineas = state.listLineas();
  const estados = await Promise.all(lineas.map(async l => {
    const st = await evo.getInstanceStatus(l.instance);
    return { seccional: l.seccional, instance: l.instance, phone: l.phone, enabled: l.enabled, banned: l.banned, estado: st.state || st, qrcode: st.qrcode || null };
  }));
  res.json({ estados });
});

router.put('/lineas', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sec = String(b.seccional || '').toUpperCase();
  if (!sec) return res.status(400).json({ error: 'seccional requerida' });
  const instance = String(b.instance || sec).trim();
  const phone = b.phone || null;
  const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);
  const banned = b.banned ? 1 : 0;
  state.upsertLinea(sec, instance, phone, enabled, banned);
  try {
    await evo.createInstance(instance);
  } catch (e) { /* puede ya existir */ }
  try {
    await evo.setWebhook(instance, require('./config').CONFIG.BOT_WEBHOOK_URL);
  } catch (e) { /* error al configurar webhook */ }
  res.json({ ok: true, linea: state.getLinea(sec) });
});

// Fuerza reconexión limpia (cierra la sesión de WhatsApp activa o atascada y genera un QR fresco)
router.post('/lineas/reconectar', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sec = String(b.seccional || '').toUpperCase();
  const linea = sec ? state.getLinea(sec) : null;
  if (!linea) return res.status(400).json({ error: 'seccional no encontrada' });
  const instance = linea.instance;
  
  // 1. Forzar logout (cierra la sesión vinculada en WhatsApp)
  try { await evo.logoutInstance(instance); } catch (e) {}
  await new Promise(r => setTimeout(r, 1000));
  
  // 2. Forzar delete
  try { await evo.deleteInstance(instance); } catch (e) {}
  await new Promise(r => setTimeout(r, 1000));

  // 3. Recrear instancia e iniciar webhook
  try { await evo.createInstance(instance); } catch (e) {}
  try { await evo.setWebhook(instance, require('./config').CONFIG.BOT_WEBHOOK_URL); } catch (e) {}

  // 4. Solicitar el QR fresco directamente
  let qrCode = null;
  try {
    const conn = await evo.connectInstance(instance);
    if (conn && conn.base64) qrCode = conn.base64;
  } catch (e) {}

  const st = await evo.getInstanceStatus(instance);
  if (qrCode) st.qrcode = qrCode;

  res.json({ ok: true, instance, estado: st });
});

// Eliminar una línea / instancia completamente
router.delete('/lineas', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sec = String(b.seccional || '').toUpperCase();
  if (!sec) return res.status(400).json({ error: 'seccional requerida' });
  const linea = state.getLinea(sec);
  if (linea && linea.instance) {
    try { await evo.deleteInstance(linea.instance); } catch (e) {}
  }
  state.deleteLinea(sec);
  res.json({ ok: true });
});


// ---------- Coordinadores ----------
router.get('/coordinadores', requireAuth, async (req, res) => {
  try {
    const mapa = await sheets.mapaVotos();
    const { coordMesa, coordSec } = sheets.getCoordinadores();
    const norm = maestro.norm;
    const mesa = coordMesa.map(c => ({
      tipo: 'mesa', telefono: c.telefono, nombre: (c.mesas[0] && c.mesas[0].nombre) || '', seccional: (c.mesas[0] && c.mesas[0].seccional) || '',
      mesas: c.mesas.map(m => ({ codigo: m.codigo, municipio: m.municipio, seccional: m.seccional, voto: mapa[`${m.codigo}|${norm(m.seccional)}|${norm(m.municipio)}`] || null })),
    }));
    const seccional = coordSec.map(c => {
      const mesasSec = maestro.mesasDeSeccional(c.seccional);
      const mesas = mesasSec.map(m => ({ codigo: m.codigo, municipio: m.municipio, seccional: m.seccional, voto: mapa[`${m.codigo}|${norm(m.seccional)}|${norm(m.municipio)}`] || null }));
      return { tipo: 'seccional', telefono: c.telefono, nombre: c.nombre, seccional: c.seccional, circunscripcion: c.circunscripcion, municipio: c.municipio, mesas };
    });
    res.json({ coordinadores: { mesa, seccional } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.contacto) return res.status(400).json({ error: 'codigo y contacto requeridos' });
  const r = await sheets.escribirCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional, nombre: b.nombre, contacto: b.contacto });
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});
router.put('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.contacto) return res.status(400).json({ error: 'codigo y contacto requeridos' });
  const r = await sheets.escribirCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional, nombre: b.nombre, contacto: b.contacto });
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});
router.delete('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo) return res.status(400).json({ error: 'codigo requerido' });
  const r = await sheets.limpiarCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional });
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});

router.post('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional || !b.contacto) return res.status(400).json({ error: 'seccional y contacto requeridos' });
  const r = await sheets.escribirCoordinadorSeccional(b);
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});
router.put('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional || !b.contacto) return res.status(400).json({ error: 'seccional y contacto requeridos' });
  const r = await sheets.escribirCoordinadorSeccional(b);
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});
router.delete('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional) return res.status(400).json({ error: 'seccional requerido' });
  const r = await sheets.limpiarCoordinadorSeccional({ seccional: b.seccional });
  if (!r.ok) return res.status(400).json(r);
  reloadCoordinadores();
  res.json(r);
});

// ---------- Importar y plantilla ----------
router.post('/importar', requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    const buffer = req.file ? req.file.buffer : undefined;
    const r = await sheets.importarDesdeSheet(buffer);
    maestro.cargar();
    reloadCoordinadores();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/plantilla', requireAuth, (req, res) => {
  const file = path.join(__dirname, '..', '3_PRECONTEO 2022-PLANCHAS.xlsx');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Plantilla no generada. Corre scripts/build-template.js' });
  res.download(file, 'plantilla-contingencia.xlsx');
});

router.get('/descargar-trabajo', requireAuth, async (req, res) => {
  try {
    const buf = await sheets.obtenerTrabajo();
    res.setHeader('Content-Disposition', 'attachment; filename="trabajo-contingencia.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Informes y alertas tempranas ----------
router.get('/informes', requireAuth, async (req, res) => {
  try { res.json(await sheets.consultarInformes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, sign, verify, autenticar, SECRET };
