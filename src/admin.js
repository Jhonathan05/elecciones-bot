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
const backup = require('./backup');

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
    let st = await evo.getInstanceStatus(l.instance);
    // Si da error con el nombre exacto de la DB, probar variante en minúsculas/capitalizada
    if ((!st.state || st.state === 'error') && l.instance) {
      const altName = l.instance.charAt(0).toUpperCase() + l.instance.slice(1).toLowerCase();
      const stAlt = await evo.getInstanceStatus(altName);
      if (stAlt && stAlt.state && stAlt.state !== 'error') {
        st = stAlt;
        state.upsertLinea(l.seccional, altName, l.phone, l.enabled, l.banned);
      }
    }
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

// Reasignar una línea a una instancia de respaldo (Failover Hot-Standby)
router.post('/lineas/failover', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sec = String(b.seccional || '').toUpperCase();
  const backupInstance = String(b.backupInstance || '').trim();
  if (!sec || !backupInstance) return res.status(400).json({ error: 'seccional y backupInstance son requeridos' });

  const ok = state.asignarRespaldo(sec, backupInstance);
  if (!ok) return res.status(400).json({ error: 'No se pudo asignar la línea de respaldo' });

  try {
    await evo.setWebhook(backupInstance, require('./config').CONFIG.BOT_WEBHOOK_URL);
  } catch (e) {}

  res.json({ ok: true, msg: `Línea ${sec} ahora atiende con la instancia de respaldo ${backupInstance}.` });
});

// Restaurar una línea a su instancia original
router.post('/lineas/restaurar', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sec = String(b.seccional || '').toUpperCase();
  if (!sec) return res.status(400).json({ error: 'seccional requerida' });

  const ok = state.restaurarRespaldo(sec);
  if (!ok) return res.status(400).json({ error: 'No se encontró instancia original para restaurar' });

  const linea = state.getLinea(sec);
  if (linea && linea.instance) {
    try {
      await evo.setWebhook(linea.instance, require('./config').CONFIG.BOT_WEBHOOK_URL);
    } catch (e) {}
  }

  res.json({ ok: true, msg: `Línea ${sec} restaurada a su instancia oficial.` });
});


// ---------- Coordinadores ----------
router.get('/coordinadores', requireAuth, async (req, res) => {
  try {
    const mapa = await sheets.mapaVotos();
    const { coordMesa: rawCoordMesa, coordSec: rawCoordSec } = sheets.getCoordinadores();
    const norm = maestro.norm;

    // 1. Obtener todas las seccionales del sistema y cruzar con coordinadores seccionales
    const seccionalesCatalog = maestro.seccionales();
    const coordSecMap = new Map();
    rawCoordSec.forEach(c => coordSecMap.set(norm(c.seccional), c));

    const seccionales = seccionalesCatalog.map(secName => {
      const c = coordSecMap.get(norm(secName));
      const mesasSec = maestro.mesasDeSeccional(secName);
      return {
        tipo: 'seccional',
        seccional: secName,
        asignado: !!c,
        telefono: c ? c.telefono : null,
        nombre: c ? c.nombre : null,
        circunscripcion: c ? c.circunscripcion : secName,
        municipio: c ? c.municipio : null,
        totalMesas: mesasSec.length,
      };
    });

    // 2. Obtener TODAS las mesas del catálogo y cruzar con coordinadores de mesa
    const coordMesaMap = new Map(); // "codigo|seccional|municipio" -> { telefono, nombre }
    rawCoordMesa.forEach(c => {
      c.mesas.forEach(m => {
        const k = `${m.codigo}|${norm(m.seccional)}|${norm(m.municipio)}`;
        coordMesaMap.set(k, { telefono: c.telefono, nombre: c.nombre || m.nombre || '' });
      });
    });

    // Construir lista completa de todas las mesas
    const todasLasMesas = [];
    const seccionalesList = maestro.seccionales();
    seccionalesList.forEach(secName => {
      const listMesas = maestro.mesasDeSeccional(secName);
      listMesas.forEach(m => {
        const k = `${m.codigo}|${norm(m.seccional)}|${norm(m.municipio)}`;
        const assigned = coordMesaMap.get(k);
        todasLasMesas.push({
          tipo: 'mesa',
          codigo: m.codigo,
          seccional: m.seccional,
          municipio: m.municipio,
          ubicacion: m.ubicacion || '',
          asignado: !!assigned,
          telefono: assigned ? assigned.telefono : null,
          nombre: assigned ? assigned.nombre : null,
          voto: mapa[`${m.codigo}|${norm(m.seccional)}|${norm(m.municipio)}`] || null,
        });
      });
    });

    res.json({ coordinadores: { seccional: seccionales, mesa: todasLasMesas } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.contacto) return res.status(400).json({ error: 'Código de mesa y teléfono/contacto son requeridos' });
  const r = await sheets.escribirCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional, nombre: b.nombre, contacto: b.contacto });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al guardar en PRECONTEO' });
  reloadCoordinadores();
  res.json({ ok: true });
});
router.put('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.contacto) return res.status(400).json({ error: 'Código de mesa y teléfono/contacto son requeridos' });
  const r = await sheets.escribirCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional, nombre: b.nombre, contacto: b.contacto });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al actualizar en PRECONTEO' });
  reloadCoordinadores();
  res.json({ ok: true });
});
router.delete('/coordinadores/mesa', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.codigo) return res.status(400).json({ error: 'Código de mesa requerido' });
  const r = await sheets.limpiarCoordinadorMesa({ codigo: b.codigo, municipio: b.municipio, seccional: b.seccional });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al eliminar coordinador' });
  reloadCoordinadores();
  res.json({ ok: true });
});

router.post('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional || !b.contacto) return res.status(400).json({ error: 'Seccional y teléfono/contacto son requeridos' });
  const r = await sheets.escribirCoordinadorSeccional(b);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al guardar coordinador seccional' });
  reloadCoordinadores();
  res.json({ ok: true });
});
router.put('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional || !b.contacto) return res.status(400).json({ error: 'Seccional y teléfono/contacto son requeridos' });
  const r = await sheets.escribirCoordinadorSeccional(b);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al actualizar coordinador seccional' });
  reloadCoordinadores();
  res.json({ ok: true });
});
router.delete('/coordinadores/seccional', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.seccional) return res.status(400).json({ error: 'Seccional requerida' });
  const r = await sheets.limpiarCoordinadorSeccional({ seccional: b.seccional });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.msg || r.error || 'Error al eliminar coordinador seccional' });
  reloadCoordinadores();
  res.json({ ok: true });
});

// ---------- Ajustes y Configuración Dinámica de Rutas ----------
router.get('/config', requireAuth, (req, res) => {
  res.json({
    ok: true,
    config: {
      sheetLocalPath: require('./config').CONFIG.SHEET_LOCAL_PATH,
      rcloneRemote: require('./config').CONFIG.RCLONE_REMOTE,
      sheetMode: require('./config').CONFIG.SHEET_MODE,
      cierreHorario: require('./config').CONFIG.CIERRE_HORARIO || 'No configurado',
    }
  });
});

router.post('/config', requireAuth, (req, res) => {
  const b = req.body || {};
  const cfg = require('./config').CONFIG;
  if (b.sheetLocalPath) cfg.SHEET_LOCAL_PATH = b.sheetLocalPath.trim();
  if (b.rcloneRemote !== undefined) cfg.RCLONE_REMOTE = b.rcloneRemote.trim();
  if (b.cierreHorario !== undefined) cfg.CIERRE_HORARIO = b.cierreHorario.trim();
  
  res.json({ ok: true, msg: 'Configuración actualizada en caliente.', config: {
    sheetLocalPath: cfg.SHEET_LOCAL_PATH,
    rcloneRemote: cfg.RCLONE_REMOTE,
    cierreHorario: cfg.CIERRE_HORARIO
  }});
});

// ---------- Backups de Seguridad Automatizados ----------
router.post('/backup', requireAuth, async (req, res) => {
  const r = backup.crearBackup();
  if (!r.ok) return res.status(500).json(r);
  res.json(r);
});

router.get('/backups', requireAuth, (req, res) => {
  res.json({ backups: backup.listarBackups() });
});

router.get('/backups/descargar/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(backup.BACKUP_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Backup no encontrado');
  res.download(filePath, name);
});

// ---------- Evidencias Fotográficas (Acta 021) ----------
router.get('/evidencias', requireAuth, (req, res) => {
  const { seccional } = req.query;
  const lista = state.listEvidencias(seccional || null);
  res.json({ evidencias: lista });
});

router.get('/evidencias/archivo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data'), 'evidencias', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Evidencia no encontrada');
  res.sendFile(filePath);
});

// ---------- Tablero Semáforo y Métricas en Vivo ----------
router.get('/semaforo', requireAuth, async (req, res) => {
  try {
    const mapa = await sheets.mapaVotos();
    const { coordMesa } = sheets.getCoordinadores();
    const coordMap = new Map();
    coordMesa.forEach(c => {
      c.mesas.forEach(m => {
        coordMap.set(`${m.codigo}|${maestro.norm(m.seccional)}|${maestro.norm(m.municipio)}`, {
          nombre: m.nombre || c.nombre || '',
          telefono: c.telefono
        });
      });
    });

    let totalMesas = 0;
    let totalInstaladas = 0;
    let totalSufragantes = 0;
    let totalActasTransmitidas = 0;
    let totalDescuadres = 0;
    let mesasDetalle = [];

    const seccionalesList = maestro.seccionales();
    seccionalesList.forEach(secName => {
      const listMesas = maestro.mesasDeSeccional(secName);
      listMesas.forEach(m => {
        totalMesas++;
        const k = `${m.codigo}|${maestro.norm(m.seccional)}|${maestro.norm(m.municipio)}`;
        const datos = mapa[k] || {};
        const inst = datos.instalacion || {};
        const part = datos.participacion || {};
        const acta = datos.acta021 || {};
        const coordInfo = coordMap.get(k) || { nombre: '', telefono: '' };

        const isInstalada = inst.instalada === 'SI';
        if (isInstalada) totalInstaladas++;
        
        const sufPart = part.totalSufragantes || 0;
        if (sufPart > 0) totalSufragantes += sufPart;

        const isActa = acta.totalSufragantes !== undefined || acta.plancha1 !== undefined;
        const isDescuadre = acta.descuadre !== undefined && acta.descuadre !== 0;
        if (isActa) totalActasTransmitidas++;
        if (isDescuadre) totalDescuadres++;

        let estadoGlobal = 'PENDIENTE';
        if (isDescuadre) estadoGlobal = 'DESCUADRE';
        else if (isActa) estadoGlobal = 'COMPLETO';
        else if (sufPart > 0 || isInstalada) estadoGlobal = 'EN_PROCESO';

        mesasDetalle.push({
          codigo: m.codigo,
          numeroLocal: m.numero_local || m.codigo,
          seccional: m.seccional,
          municipio: m.municipio,
          ubicacion: m.ubicacion || 'Puesto Principal',
          coordinador: coordInfo.nombre,
          telefono: coordInfo.telefono,
          instalacion: {
            reportada: isInstalada,
            jurados: inst.jurados || 0,
            kit: inst.kitElectoral || '-',
            sillas: inst.sillas || '-',
            mesa: inst.mesa || '-',
            obs: inst.observaciones || ''
          },
          participacion: {
            sufragantes: sufPart,
            boletin1: part.b1 || 0,
            boletin2: part.b2 || 0,
            boletin3: part.b3 || 0
          },
          acta021: {
            reportada: isActa,
            totalVotos: acta.totalSufragantes || 0,
            plancha1: acta.plancha1 || 0,
            plancha2: acta.plancha2 || 0,
            plancha3: acta.plancha3 || 0,
            plancha4: acta.plancha4 || 0,
            plancha5: acta.plancha5 || 0,
            blanco: acta.blanco || 0,
            nulos: acta.nulos || 0,
            noMarcados: acta.noMarcados || 0,
            incinerados: acta.incinerados || 0,
            descuadre: acta.descuadre || 0,
            alerta: acta.alerta || 'OK'
          },
          estadoGlobal
        });
      });
    });

    res.json({
      ok: true,
      resumen: {
        totalMesas,
        totalInstaladas,
        pctInstaladas: totalMesas ? Math.round((totalInstaladas / totalMesas) * 100) : 0,
        totalSufragantes,
        totalActasTransmitidas,
        pctActas: totalMesas ? Math.round((totalActasTransmitidas / totalMesas) * 100) : 0,
        totalDescuadres,
        totalPendientes: totalMesas - totalActasTransmitidas
      },
      mesas: mesasDetalle
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Exportación Consolidada a CSV ----------
router.get('/exportar-csv', requireAuth, async (req, res) => {
  try {
    const mapa = await sheets.mapaVotos();
    const { coordMesa } = sheets.getCoordinadores();
    const coordMap = new Map();
    coordMesa.forEach(c => {
      c.mesas.forEach(m => {
        coordMap.set(`${m.codigo}|${maestro.norm(m.seccional)}|${maestro.norm(m.municipio)}`, c.telefono);
      });
    });

    let csv = 'SECCIONAL,MUNICIPIO,MESA,COORDINADOR_TEL,INSTALADA,SUFRAGANTES_PARTICIPACION,TOTAL_VOTOS_ACTA,PLANCHA_1,PLANCHA_2,PLANCHA_3,PLANCHA_4,PLANCHA_5,BLANCO,NULOS,NO_MARCADOS,INCINERADOS,ALERTA_ACTA\n';

    const seccionalesList = maestro.seccionales();
    seccionalesList.forEach(secName => {
      const listMesas = maestro.mesasDeSeccional(secName);
      listMesas.forEach(m => {
        const k = `${m.codigo}|${maestro.norm(m.seccional)}|${maestro.norm(m.municipio)}`;
        const datos = mapa[k] || {};
        const inst = datos.instalacion || {};
        const part = datos.participacion || {};
        const acta = datos.acta021 || {};
        const coordTel = coordMap.get(k) || '';

        csv += `"${m.seccional}","${m.municipio}",${m.codigo},"${coordTel}","${inst.instalada || 'NO'}",${part.totalSufragantes || 0},${acta.totalSufragantes || 0},${acta.plancha1 || 0},${acta.plancha2 || 0},${acta.plancha3 || 0},${acta.plancha4 || 0},${acta.plancha5 || 0},${acta.blanco || 0},${acta.nulos || 0},${acta.noMarcados || 0},${acta.incinerados || 0},"${acta.alerta || 'PENDIENTE'}"\n`;
      });
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="consolidado-electoral.csv"');
    res.send(csv);
  } catch (e) { res.status(500).send('Error al generar CSV: ' + e.message); }
});

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
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Plantilla no encontrada' });
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
