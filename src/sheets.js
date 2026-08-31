'use strict';
// sheets.js — backend de almacenamiento del bot.
// Modo principal: local (xlsx + rclone). El bot escribe SOLO las celdas/filas
// de la mesa reportada; el archivo en Google Drive es fuente de verdad y los
// humanos lo editan vía Google Sheets web. Sincronización viva por cada reporte.
// (El modo google quedó deprecado; ver docs/DESPLIEGUE-MANUAL.md.)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const X = require('xlsx');
const { CONFIG } = require('./config');
const state = require('./state');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const ALERTA_RED = 'FFFFC7CE';
const OK_GREEN = 'FFC6EFCE';

function norm(v) { return (v === undefined || v === null) ? '' : String(v).trim().toUpperCase(); }
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function digits(v) { return v ? String(v).replace(/\D/g, '') : ''; }

// ---- Mutex serializado (un solo escritor a la vez) ----
let _locked = false;
const _waiters = [];
function withLock(task) {
  return new Promise(resolve => {
    const run = () => {
      _locked = true;
      Promise.resolve().then(task).then(resolve, resolve).finally(() => {
        if (_waiters.length) _waiters.shift()();
        else _locked = false;
      });
    };
    if (_locked) _waiters.push(run);
    else run();
  });
}

// ---- rclone ----
let _rcloneOk = null;
function rcloneRun(args) {
  return new Promise(resolve => {
    const p = spawn('rclone', args, { windowsHide: true });
    let err = '';
    p.stderr && p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ ok: false, err: e.message }));
    p.on('close', c => resolve({ ok: c === 0, code: c, err }));
  });
}
async function rcloneCheck() {
  if (_rcloneOk !== null) return _rcloneOk;
  const r = await rcloneRun(['--version']);
  _rcloneOk = r.ok;
  return _rcloneOk;
}
async function syncPull() {
  if (!CONFIG.RCLONE_REMOTE) return;
  if (!(await rcloneCheck())) { console.warn('[rclone] no disponible: trabajo solo sobre caché local.'); return; }
  const r = await rcloneRun(['copyto', CONFIG.RCLONE_REMOTE, CONFIG.SHEET_LOCAL_PATH]);
  if (!r.ok) console.warn('[rclone] pull falló:', r.err.trim());
}
async function syncPush() {
  if (!CONFIG.RCLONE_REMOTE) return;
  if (!(await rcloneCheck())) { console.warn('[rclone] no disponible: cambios NO subidos a Drive.'); return; }
  const r = await rcloneRun(['copyto', CONFIG.SHEET_LOCAL_PATH, CONFIG.RCLONE_REMOTE]);
  if (!r.ok) console.warn('[rclone] push falló:', r.err.trim());
}

// ---- Lectura/escritura del workbook local ----
function loadWb() { return X.readFile(CONFIG.SHEET_LOCAL_PATH); }
function saveWb(wb) {
  const tmp = CONFIG.SHEET_LOCAL_PATH.replace(/(\.xlsx)?$/i, '.tmp.xlsx');
  X.writeFile(wb, tmp);
  fs.renameSync(tmp, CONFIG.SHEET_LOCAL_PATH);
}
function headerMap(ws) {
  const map = {};
  if (!ws || !ws['!ref']) return map;
  const range = X.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[X.utils.encode_cell({ r: range.s.r, c })];
    if (cell && cell.v !== undefined) map[String(cell.v).trim()] = c;
  }
  return map;
}
function setCell(ws, r, c, val, fill) {
  const addr = X.utils.encode_cell({ r, c });
  if (val === undefined || val === null) { delete ws[addr]; return; }
  const isNum = typeof val === 'number';
  const cell = { t: isNum ? 'n' : 's', v: isNum ? val : String(val) };
  if (fill) cell.s = { fill: { fgColor: { rgb: fill } } };
  ws[addr] = cell;
}
function versionActualLocal(wb, hoja, row) {
  try {
    const m = maps[hoja];
    const c = m && m['VERSION'];
    if (c === undefined) return 0;
    const cell = wb.Sheets[hoja][X.utils.encode_cell({ r: row, c })];
    const n = Number(cell ? cell.v : 0);
    return isNaN(n) ? 0 : n;
  } catch (e) { return 0; }
}

let maps = {};
let rowsIdx = {};
let coordinadores = { coordMesa: [], coordSec: [] };

function buildIndex(wb) {
  rowsIdx = {};
  ['PRECONTEO', 'INSTALACION', 'PARTICIPACION'].forEach(h => {
    const ws = wb.Sheets[h];
    if (!ws || !maps[h]) { rowsIdx[h] = []; return; }
    const m = maps[h];
    const rows = X.utils.sheet_to_json(ws, { header: 1, defval: undefined, blankrows: false });
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const codigo = Number(row[m['CÓDIGO MESA']]);
      if (!codigo) continue;
      out.push({ codigo, seccional: norm(row[m['SECCIONAL UBICACION MESA']]), municipio: norm(row[m['MUNICIPIO POR EL QUE VOTA']]), row: i });
    }
    rowsIdx[h] = out;
  });
}
function findRow(hoja, codigo, seccional, municipio) {
  const list = rowsIdx[hoja] || [];
  const c = Number(codigo);
  const s = norm(seccional);
  const m = norm(municipio);
  return list.find(x => x.codigo === c && x.seccional === s && (!m || x.municipio === m)) || null;
}
function readCoordinadores(wb) {
  const byPhoneMesa = {};
  const byPhoneSec = {};
  const pws = wb.Sheets['PRECONTEO'];
  if (pws && maps['PRECONTEO']) {
    const m = maps['PRECONTEO'];
    const rows = X.utils.sheet_to_json(pws, { header: 1, defval: undefined, blankrows: false });
    const cCod = m['CÓDIGO MESA'], cSec = m['SECCIONAL UBICACION MESA'], cMun = m['MUNICIPIO POR EL QUE VOTA'], cNom = m['NOMBRE COORD MESA'], cCon = m['CONTACTO COORD MESA'];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const contacto = digits(row[cCon]);
      if (!contacto) continue;
      byPhoneMesa[contacto] = (byPhoneMesa[contacto] || []).concat([{ codigo: Number(row[cCod]), municipio: norm(row[cMun]), seccional: norm(row[cSec]), nombre: row[cNom] || '' }]);
    }
  }
  const sws = wb.Sheets['SECCIONALES'];
  if (sws && maps['SECCIONALES']) {
    const m = maps['SECCIONALES'];
    const rows = X.utils.sheet_to_json(sws, { header: 1, defval: undefined, blankrows: false });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const contacto = digits(row[4]);
      if (!contacto) continue;
      byPhoneSec[contacto] = { seccional: norm(row[0]), nombre: row[3] || '', circunscripcion: norm(row[1]), municipio: row[2] || '' };
    }
  }
  return {
    coordMesa: Object.entries(byPhoneMesa).map(([telefono, mesas]) => ({ telefono, mesas })),
    coordSec: Object.entries(byPhoneSec).map(([telefono, info]) => ({ telefono, ...info })),
  };
}
function analyze(wb) {
  maps = {};
  ['PRECONTEO', 'INSTALACION', 'PARTICIPACION', 'SECCIONALES'].forEach(h => {
    const ws = wb.Sheets[h];
    if (ws) maps[h] = headerMap(ws);
  });
  buildIndex(wb);
  coordinadores = readCoordinadores(wb);
}
function appendHistorial(wb, e) {
  const hs = wb.Sheets['HISTORIAL'];
  if (!hs) return;
  const rows = X.utils.sheet_to_json(hs, { header: 1, defval: undefined, blankrows: false });
  const r = rows.length;
  const vals = [e.timestamp, e.linea, e.telefono, e.mesa, e.momento, e.campo, e.valor_anterior, e.valor_nuevo, e.motivo];
  vals.forEach((v, c) => setCell(hs, r, c, v));
  const range = X.utils.decode_range(hs['!ref'] || 'A1:I1');
  range.e.r = Math.max(range.e.r, r);
  hs['!ref'] = X.utils.encode_range(range);
}

// ---- API pública ----

async function init() {
  if (CONFIG.SHEET_MODE === 'google') {
    throw new Error('Modo google deprecado. Usa SHEET_MODE=local con RCLONE_REMOTE.');
  }
  if (CONFIG.RCLONE_REMOTE) await syncPull();
  if (!fs.existsSync(CONFIG.SHEET_LOCAL_PATH)) {
    const seed = path.join(__dirname, '..', '3_PRECONTEO 2022-PLANCHAS.xlsx');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, CONFIG.SHEET_LOCAL_PATH);
    else throw new Error('SHEET_LOCAL_PATH no existe y no hay semilla: ' + CONFIG.SHEET_LOCAL_PATH);
  }
  analyze(loadWb());
  
  // Sembrar automáticamente las seccionales en la tabla lineas de la base de datos si no existen
  try {
    const wb = loadWb();
    if (wb.Sheets['SECCIONALES'] && maps['SECCIONALES']) {
      const sws = wb.Sheets['SECCIONALES'];
      const rows = X.utils.sheet_to_json(sws, { header: 1, defval: undefined, blankrows: false });
      rows.slice(1).forEach(row => {
        const sec = norm(row[0]);
        if (sec && sec !== 'N/A') {
          const cur = state.getLinea(sec);
          if (!cur) {
            const num = digits(row[5]);
            state.upsertLinea(sec, sec.toLowerCase(), num || null, 1, 0);
          }
        }
      });
    }
  } catch (e) {
    console.warn('Error al sembrar líneas iniciales de seccionales:', e.message);
  }

  console.log('[sheets] local listo. PRECONTEO filas:', (rowsIdx['PRECONTEO'] || []).length,
    '| coord mesa:', coordinadores.coordMesa.length, '| coord seccional:', coordinadores.coordSec.length);
  return true;
}

async function cargarCoordinadores() {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    analyze(wb);
    return coordinadores;
  });
}
function getCoordinadores() { return coordinadores; }

async function escribirCoordinadorMesa({ codigo, municipio, seccional, nombre, contacto }) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const f = findRow('PRECONTEO', codigo, seccional, municipio);
    if (!f) return { ok: false, msg: `Mesa ${codigo} no encontrada en PRECONTEO` };
    const m = maps['PRECONTEO'];
    setCell(wb.Sheets['PRECONTEO'], f.row, m['NOMBRE COORD MESA'], nombre || '');
    setCell(wb.Sheets['PRECONTEO'], f.row, m['CONTACTO COORD MESA'], digits(contacto) || '');
    saveWb(wb);
    await syncPush();
    return { ok: true };
  }).then(r => {
    if (r.ok) { try { coordinadores = readCoordinadores(loadWb()); } catch (e) {} }
    return r;
  });
}
function limpiarCoordinadorMesa({ codigo, municipio, seccional }) {
  return escribirCoordinadorMesa({ codigo, municipio, seccional, nombre: '', contacto: '' });
}
async function escribirCoordinadorSeccional({ seccional, nombre, contacto, municipio, circunscripcion, numero }) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const sws = wb.Sheets['SECCIONALES'];
    if (!sws) return { ok: false, msg: 'Hoja SECCIONALES ausente' };
    const m = maps['SECCIONALES'];
    const rows = X.utils.sheet_to_json(sws, { header: 1, defval: undefined, blankrows: false });
    let idx = -1;
    for (let i = 1; i < rows.length; i++) { if (norm(rows[i][0]) === norm(seccional)) { idx = i; break; } }
    const rowData = [seccional, circunscripcion || '', municipio || '', nombre || '', digits(contacto) || '', numero || ''];
    if (idx >= 0) rowData.forEach((v, c) => setCell(sws, idx, c, v));
    else { const newRow = rows.length || 1; rowData.forEach((v, c) => setCell(sws, newRow, c, v)); }
    saveWb(wb);
    await syncPush();
    return { ok: true };
  }).then(r => {
    if (r.ok) {
      try { coordinadores = readCoordinadores(loadWb()); } catch (e) {}
      if (numero) state.upsertLinea(norm(seccional), norm(seccional), digits(numero), 1, 0);
    }
    return r;
  });
}
function limpiarCoordinadorSeccional({ seccional }) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const sws = wb.Sheets['SECCIONALES'];
    if (!sws) return { ok: false, msg: 'Hoja SECCIONALES ausente' };
    const rows = X.utils.sheet_to_json(sws, { header: 1, defval: undefined, blankrows: false });
    let idx = -1;
    for (let i = 1; i < rows.length; i++) { if (norm(rows[i][0]) === norm(seccional)) { idx = i; break; } }
    if (idx >= 0) { setCell(sws, idx, 3, ''); setCell(sws, idx, 4, ''); setCell(sws, idx, 5, ''); }
    saveWb(wb);
    await syncPush();
    return { ok: true };
  });
}

async function escribirInstalacion(codigo, seccional, municipio, data, ctx) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const f = findRow('INSTALACION', codigo, seccional, municipio);
    if (!f) return { ok: false, msg: `Mesa ${codigo} no en INSTALACION` };
    const m = maps['INSTALACION'];
    const ws = wb.Sheets['INSTALACION'];
    const jur = Number(data.jurados);
    const kit = data.kitElectoral;
    const sil = data.sillas;
    const mes = data.mesa;
    const instalada = (jur === 3 && kit === 'Recibido' && sil === 'Completas' && mes === 'Está') ? 'SI' : 'NO';
    const alerta = instalada === 'SI' ? 'OK' : 'ALERTA';
    setCell(ws, f.row, m['JURADOS'], jur);
    setCell(ws, f.row, m['KIT ELECTORAL'], kit);
    setCell(ws, f.row, m['SILLAS'], sil);
    setCell(ws, f.row, m['MESA FÍSICA'], mes);
    setCell(ws, f.row, m['OBSERVACIONES'], data.observaciones || '');
    setCell(ws, f.row, m['INSTALADA'], instalada);
    setCell(ws, f.row, m['ALERTA'], alerta, alerta === 'ALERTA' ? ALERTA_RED : OK_GREEN);
    setCell(ws, f.row, m['REPORTADO_POR'], ctx.telefono || '');
    setCell(ws, f.row, m['FECHA_REPORTE'], new Date().toISOString());
    setCell(ws, f.row, m['VERSION'], versionActualLocal(wb, 'INSTALACION', f.row) + 1);
    setCell(ws, f.row, m['ESTADO'], 'CONFIRMADA');
    appendHistorial(wb, { timestamp: new Date().toISOString(), linea: ctx.linea || '', telefono: ctx.telefono || '', mesa: codigo, momento: 'instalacion', campo: 'todo', valor_anterior: 'PENDIENTE', valor_nuevo: 'CONFIRMADA', motivo: 'whatsapp' });
    saveWb(wb);
    await syncPush();
    return { ok: true };
  });
}

async function escribirParticipacion(codigo, seccional, municipio, boletines, ctx) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const f = findRow('PARTICIPACION', codigo, seccional, municipio);
    if (!f) return { ok: false, msg: `Mesa ${codigo} no en PARTICIPACION` };
    const m = maps['PARTICIPACION'];
    const ws = wb.Sheets['PARTICIPACION'];
    let total = 0;
    for (const k of ['1', '2', '3']) {
      if (boletines[k]) {
        const sf = Number(boletines[k].sufragantes) || 0;
        setCell(ws, f.row, m['SUFRAGANTES B' + k], sf);
        setCell(ws, f.row, m['OBS B' + k], boletines[k].observaciones || '');
        total += sf;
      }
    }
    setCell(ws, f.row, m['TOTAL SUFRAGANTES'], total);
    const alerta = total > 0 ? 'OK' : 'PENDIENTE';
    setCell(ws, f.row, m['ALERTA'], alerta, alerta === 'OK' ? OK_GREEN : undefined);
    setCell(ws, f.row, m['REPORTADO_POR'], ctx.linea || '');
    setCell(ws, f.row, m['FECHA_REPORTE'], new Date().toISOString());
    setCell(ws, f.row, m['VERSION'], versionActualLocal(wb, 'PARTICIPACION', f.row) + 1);
    setCell(ws, f.row, m['ESTADO'], 'CONFIRMADA');
    appendHistorial(wb, { timestamp: new Date().toISOString(), linea: ctx.linea || '', telefono: ctx.telefono || '', mesa: codigo, momento: 'participacion', campo: 'todo', valor_anterior: 'PENDIENTE', valor_nuevo: 'CONFIRMADA', motivo: 'whatsapp' });
    saveWb(wb);
    await syncPush();
    return { ok: true };
  });
}

async function escribirActa021(codigo, seccional, municipio, data, ctx) {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const f = findRow('PRECONTEO', codigo, seccional, municipio);
    if (!f) return { ok: false, msg: `Mesa ${codigo} no en PRECONTEO` };
    const m = maps['PRECONTEO'];
    const ws = wb.Sheets['PRECONTEO'];
    const p = [Number(data.plancha1) || 0, Number(data.plancha2) || 0, Number(data.plancha3) || 0, Number(data.plancha4) || 0, Number(data.plancha5) || 0];
    const blanco = Number(data.blanco) || 0;
    const nulos = Number(data.nulos) || 0;
    const inc = Number(data.incinerados) || 0;
    const nm = Number(data.noMarcados) || 0;
    const totalV = Number(data.totalVotosMesa) || 0;
    const suma = p.reduce((a, b) => a + b, 0) + blanco + nulos + inc + nm;
    const control = (totalV === suma) ? 'SI' : 'NO';
    const desc = totalV - suma;
    const alerta = totalV ? (totalV === suma ? 'OK' : 'ALERTA CUADRE') : 'PENDIENTE';
    setCell(ws, f.row, m['MESAS REPORTADAS'], 1);
    setCell(ws, f.row, m['Total Sufragantes Planchas'], totalV);
    setCell(ws, f.row, m['Votos Incinerados Planchas'], inc);
    setCell(ws, f.row, m['Plancha 1'], p[0]);
    setCell(ws, f.row, m['Plancha 2'], p[1]);
    setCell(ws, f.row, m['Plancha 3'], p[2]);
    setCell(ws, f.row, m['Plancha 4'], p[3]);
    setCell(ws, f.row, m['Plancha 5'], p[4]);
    setCell(ws, f.row, m['Votos en Blanco Planchas'], blanco);
    setCell(ws, f.row, m['Votos Nulos Planchas'], nulos);
    setCell(ws, f.row, m['Votos no Marcados Planchas'], nm);
    setCell(ws, f.row, m['CONTROL'], control);
    setCell(ws, f.row, m['DESCUADRE'], desc);
    setCell(ws, f.row, m['ALERTA'], alerta, alerta === 'OK' ? OK_GREEN : (alerta === 'ALERTA CUADRE' ? ALERTA_RED : undefined));
    appendHistorial(wb, { timestamp: new Date().toISOString(), linea: ctx.linea || '', telefono: ctx.telefono || '', mesa: codigo, momento: 'acta021', campo: 'todo', valor_anterior: 'PENDIENTE', valor_nuevo: alerta, motivo: 'whatsapp' });
    saveWb(wb);
    await syncPush();
    return { ok: true, alerta: alerta === 'ALERTA CUADRE' ? `⚠ Descuadre de ${desc} voto(s).` : undefined };
  });
}

async function mapaVotos() {
  return withLock(async () => {
    await syncPull();
    const wb = loadWb();
    const mP = maps['PRECONTEO'], mI = maps['INSTALACION'], mPa = maps['PARTICIPACION'];
    const readSheet = (ws, m, headers) => {
      if (!ws || !m) return [];
      const rows = X.utils.sheet_to_json(ws, { header: 1, defval: undefined, blankrows: false });
      return rows.slice(1).map(row => { const o = {}; headers.forEach(h => o[h] = row[m[h]]); return o; });
    };
    
    const pre = readSheet(wb.Sheets['PRECONTEO'], mP, [
      'SECCIONAL UBICACION MESA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA', 'CONTROL', 'DESCUADRE', 'ALERTA',
      'MESAS REPORTADAS', 'Total Sufragantes Planchas', 'Plancha 1', 'Plancha 2', 'Plancha 3', 'Plancha 4', 'Plancha 5',
      'Votos en Blanco Planchas', 'Votos Nulos Planchas', 'Votos no Marcados Planchas', 'Votos Incinerados Planchas', 'OTRAS CONSTANCIAS'
    ]);
    
    const inst = readSheet(wb.Sheets['INSTALACION'], mI, [
      'SECCIONAL UBICACION MESA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA', 'INSTALADA', 'ALERTA',
      'JURADOS', 'KIT ELECTORAL', 'SILLAS', 'MESA FÍSICA', 'OBSERVACIONES'
    ]);
    
    const part = readSheet(wb.Sheets['PARTICIPACION'], mPa, [
      'SECCIONAL UBICACION MESA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA', 'TOTAL SUFRAGANTES', 'ALERTA',
      'SUFRAGANTES B1', 'OBS B1', 'SUFRAGANTES B2', 'OBS B2', 'SUFRAGANTES B3', 'OBS B3'
    ]);
    
    const map = {};
    const key = r => `${r['CÓDIGO MESA']}|${norm(r['SECCIONAL UBICACION MESA'])}|${norm(r['MUNICIPIO POR EL QUE VOTA'])}`;
    
    pre.forEach(r => {
      const k = key(r);
      map[k] = map[k] || {};
      map[k].acta021 = {
        reportada: num(r['MESAS REPORTADAS']) === 1,
        control: norm(r['CONTROL']),
        descuadre: num(r['DESCUADRE']),
        alerta: norm(r['ALERTA']),
        totalSufragantes: num(r['Total Sufragantes Planchas']),
        plancha1: num(r['Plancha 1']),
        plancha2: num(r['Plancha 2']),
        plancha3: num(r['Plancha 3']),
        plancha4: num(r['Plancha 4']),
        plancha5: num(r['Plancha 5']),
        blanco: num(r['Votos en Blanco Planchas']),
        nulos: num(r['Votos Nulos Planchas']),
        noMarcados: num(r['Votos no Marcados Planchas']),
        incinerados: num(r['Votos Incinerados Planchas']),
        observaciones: r['OTRAS CONSTANCIAS'] || ''
      };
    });
    
    inst.forEach(r => {
      const k = key(r);
      map[k] = map[k] || {};
      map[k].instalacion = {
        instalada: norm(r['INSTALADA']),
        alerta: norm(r['ALERTA']),
        jurados: num(r['JURADOS']),
        kit: r['KIT ELECTORAL'] || '',
        sillas: r['SILLAS'] || '',
        mesaFisica: r['MESA FÍSICA'] || '',
        observaciones: r['OBSERVACIONES'] || ''
      };
    });
    
    part.forEach(r => {
      const k = key(r);
      map[k] = map[k] || {};
      map[k].participacion = {
        totalSufragantes: num(r['TOTAL SUFRAGANTES']),
        alerta: norm(r['ALERTA']),
        b1: { sufragantes: num(r['SUFRAGANTES B1']), obs: r['OBS B1'] || '' },
        b2: { sufragantes: num(r['SUFRAGANTES B2']), obs: r['OBS B2'] || '' },
        b3: { sufragantes: num(r['SUFRAGANTES B3']), obs: r['OBS B3'] || '' }
      };
    });
    
    return map;
  });
}

async function consultarInformes() {
  const map = await mapaVotos();
  const alertasActa = [], alertasInst = [], alertasPart = [], descuadres = [];
  Object.values(map).forEach(m => {
    const a = m.acta021;
    if (a) {
      if (a.alerta && a.alerta !== 'OK') alertasActa.push({ ...m, alerta: a.alerta });
      if (a.alerta === 'ALERTA CUADRE') descuadres.push({ ...m, descuadre: a.descuadre });
    }
    if (m.instalacion && m.instalacion.alerta && m.instalacion.alerta !== 'OK') alertasInst.push({ ...m, alerta: m.instalacion.alerta });
    if (m.participacion && m.participacion.alerta && m.participacion.alerta !== 'OK') alertasPart.push({ ...m, alerta: m.participacion.alerta });
  });
  return {
    resumen: {
      mesasConAlertaActa: alertasActa.length,
      mesasConAlertaInstalacion: alertasInst.length,
      mesasConAlertaParticipacion: alertasPart.length,
      descuadres: descuadres.length,
    },
    alertasActa, alertasInstalacion: alertasInst, alertasParticipacion: alertasPart, descuadres,
  };
}

async function obtenerTrabajo() {
  if (CONFIG.RCLONE_REMOTE) await syncPull();
  if (!fs.existsSync(CONFIG.SHEET_LOCAL_PATH)) throw new Error('No hay archivo de trabajo local');
  return fs.readFileSync(CONFIG.SHEET_LOCAL_PATH);
}

async function importarDesdeSheet(buffer) {
  return withLock(async () => {
    if (buffer) fs.writeFileSync(CONFIG.SHEET_LOCAL_PATH, buffer);
    if (CONFIG.RCLONE_REMOTE) await syncPull();
    const wb = loadWb();
    const m = maps['PRECONTEO'];
    const rows = X.utils.sheet_to_json(wb.Sheets['PRECONTEO'], { header: 1, defval: undefined, blankrows: false });
    const mesas = rows.slice(1).map(row => {
      const g = h => row[m[h]];
      return {
        codigo: Number(g('CÓDIGO MESA')),
        seccional: norm(g('SECCIONAL UBICACION MESA')),
        circunscripcion: norm(g('CIRCUNSCRIPCIÓN POR LA QUE VOTA')),
        municipio: g('MUNICIPIO POR EL QUE VOTA') || g('MUNICIPIO UBICACION MESA'),
        numero_local: g('NUMERO_MESA'),
        ubicacion: g('UBICACION'),
      };
    }).filter(x => x.codigo);
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, 'mesas.json'), JSON.stringify(mesas, null, 2));
    const sm = maps['SECCIONALES'];
    const srows = X.utils.sheet_to_json(wb.Sheets['SECCIONALES'], { header: 1, defval: undefined, blankrows: false });
    srows.slice(1).forEach(row => { const sec = norm(row[0]); const num = digits(row[5]); if (sec) state.upsertLinea(sec, sec, num || null, 1, 0); });
    await syncPush();
    analyze(wb);
    return { ok: true, mesas: mesas.length };
  });
}

module.exports = {
  init,
  cargarCoordinadores,
  getCoordinadores,
  importarDesdeSheet,
  escribirInstalacion,
  escribirParticipacion,
  escribirActa021,
  escribirCoordinadorMesa,
  limpiarCoordinadorMesa,
  escribirCoordinadorSeccional,
  limpiarCoordinadorSeccional,
  mapaVotos,
  consultarInformes,
  obtenerTrabajo,
};
