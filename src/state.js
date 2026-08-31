'use strict';
// state.js — persistencia local del bot (mejor-sqlite3, modo WAL).
// Tablas: lineas (seccional<->instancia Evolution), sesiones (conversación por teléfono), admins.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'bot-state.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS lineas (
  seccional TEXT PRIMARY KEY,
  instance  TEXT NOT NULL,
  phone     TEXT,
  enabled   INTEGER NOT NULL DEFAULT 1,
  banned    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sesiones (
  phone TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  user      TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lid_mappings (
  lid   TEXT PRIMARY KEY,
  phone TEXT NOT NULL
);
`);

// ---------- Líneas (seccional -> instancia Evolution) ----------
function listLineas() {
  return db.prepare('SELECT seccional, instance, phone, enabled, banned FROM lineas ORDER BY seccional').all();
}
function getLinea(seccional) {
  return db.prepare('SELECT * FROM lineas WHERE seccional = ?').get(seccional);
}
function getLineaPorInstance(instance) {
  if (!instance) return null;
  const instUpper = String(instance).trim().toUpperCase();
  return db.prepare('SELECT * FROM lineas WHERE UPPER(instance) = ? OR UPPER(seccional) = ?').get(instUpper, instUpper);
}
function upsertLinea(seccional, instance, phone, enabled = 1, banned = 0) {
  db.prepare(`INSERT INTO lineas (seccional, instance, phone, enabled, banned)
    VALUES (@seccional, @instance, @phone, @enabled, @banned)
    ON CONFLICT(seccional) DO UPDATE SET instance=@instance, phone=@phone, enabled=@enabled, banned=@banned`).run(
    { seccional, instance, phone: phone || null, enabled, banned });
}
function setLineaEstado(seccional, { enabled, banned, phone, instance } = {}) {
  const cur = getLinea(seccional) || { instance: seccional, phone: null, enabled: 1, banned: 0 };
  db.prepare(`UPDATE lineas SET enabled=@enabled, banned=@banned, phone=@phone, instance=@instance WHERE seccional=@seccional`).run({
    seccional,
    instance: instance !== undefined ? instance : cur.instance,
    phone: phone !== undefined ? phone : cur.phone,
    enabled: enabled !== undefined ? enabled : cur.enabled,
    banned: banned !== undefined ? banned : cur.banned,
  });
}

// ---------- Sesiones de conversación ----------
function getSession(phone) {
  const row = db.prepare('SELECT data FROM sesiones WHERE phone = ?').get(phone);
  return row ? JSON.parse(row.data) : null;
}
function saveSession(phone, data) {
  db.prepare('INSERT INTO sesiones (phone, data) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET data=?')
    .run(phone, JSON.stringify(data), JSON.stringify(data));
}
function clearSession(phone) {
  db.prepare('DELETE FROM sesiones WHERE phone = ?').run(phone);
}

// ---------- Admins ----------
function getAdmin(user) {
  return db.prepare('SELECT * FROM admins WHERE user = ?').get(user);
}
function setAdmin(user, passHash) {
  db.prepare('INSERT INTO admins (user, pass_hash) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET pass_hash=?')
    .run(user, passHash, passHash);
}

function deleteLinea(seccional) {
  db.prepare('DELETE FROM lineas WHERE seccional = ?').run(seccional);
}

// ---------- Mapeo de LIDs (WhatsApp Privacy ID -> Teléfono) ----------
function listLidMappings() {
  return db.prepare('SELECT lid, phone FROM lid_mappings').all();
}
function getLidMapping(lid) {
  if (!lid) return null;
  const row = db.prepare('SELECT phone FROM lid_mappings WHERE lid = ?').get(String(lid).trim());
  return row ? row.phone : null;
}
function setLidMapping(lid, phone) {
  if (!lid || !phone) return;
  db.prepare('INSERT INTO lid_mappings (lid, phone) VALUES (?, ?) ON CONFLICT(lid) DO UPDATE SET phone=?')
    .run(String(lid).trim(), String(phone).trim(), String(phone).trim());
}

module.exports = {
  db, DB_PATH,
  listLineas, getLinea, getLineaPorInstance, upsertLinea, setLineaEstado, deleteLinea,
  getSession, saveSession, clearSession,
  getAdmin, setAdmin,
  listLidMappings, getLidMapping, setLidMapping,
};
