'use strict';
// backup.js — generación de snapshots en caliente y rotación de backups
const fs = require('fs');
const path = require('path');
const config = require('./config').CONFIG;

const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 50;

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function formatearFechaTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function crearBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    
    const ts = formatearFechaTimestamp();
    const resultados = { timestamp: ts, excel: null, db: null };

    // 1. Snapshot del archivo Excel
    const excelSrc = config.SHEET_LOCAL_PATH;
    if (fs.existsSync(excelSrc)) {
      const excelDestName = `backup_excel_${ts}.xlsx`;
      const excelDestPath = path.join(BACKUP_DIR, excelDestName);
      fs.copyFileSync(excelSrc, excelDestPath);
      resultados.excel = excelDestName;
    }

    // 2. Snapshot de la base de datos SQLite (bot-state.db)
    const dbSrc = path.join(DATA_DIR, 'bot-state.db');
    if (fs.existsSync(dbSrc)) {
      const dbDestName = `backup_state_${ts}.db`;
      const dbDestPath = path.join(BACKUP_DIR, dbDestName);
      fs.copyFileSync(dbSrc, dbDestPath);
      resultados.db = dbDestName;
    }

    // 3. Rotación de backups antiguos
    rotarBackups();

    return { ok: true, ...resultados };
  } catch (e) {
    console.error('[BACKUP] Error al generar backup:', e.message);
    return { ok: false, error: e.message };
  }
}

function rotarBackups() {
  try {
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (archivos.length > MAX_BACKUPS) {
      const aEliminar = archivos.slice(MAX_BACKUPS);
      aEliminar.forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch {}
      });
    }
  } catch (e) {
    console.error('[BACKUP] Error rotando backups:', e.message);
  }
}

function listarBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_'))
      .map(f => {
        const full = path.join(BACKUP_DIR, f);
        const st = fs.statSync(full);
        return {
          nombre: f,
          size: st.size,
          fecha: new Date(st.mtimeMs).toISOString(),
          tipo: f.endsWith('.xlsx') ? 'Excel' : (f.endsWith('.db') ? 'SQLite' : 'Otro')
        };
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  } catch (e) {
    return [];
  }
}

// Iniciar intervalo de backups periódicos cada 15 minutos (900000 ms)
let backupTimer = null;
function iniciarCronBackups(intervaloMs = 15 * 60 * 1000) {
  if (backupTimer) clearInterval(backupTimer);
  console.log(`[BACKUP] Sistema de copias automáticas activado (cada ${intervaloMs / 60000} minutos).`);
  backupTimer = setInterval(() => {
    const res = crearBackup();
    if (res.ok) console.log(`[BACKUP AUTOMÁTICO] Backup generado: ${res.excel || ''} | ${res.db || ''}`);
  }, intervaloMs);
}

module.exports = {
  crearBackup,
  listarBackups,
  iniciarCronBackups,
  BACKUP_DIR
};
