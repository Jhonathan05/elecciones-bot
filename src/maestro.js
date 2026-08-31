'use strict';
// maestro.js — catálogo local de mesas (config/mesas.json) + coordinadores (del Sheet, en caliente).
// Permite validar código de mesa y hacer scoping por asignación de coordinador aunque el app esté caído.
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.BOT_CONFIG_DIR || path.join(__dirname, '..', 'config');

let mesas = [];           // [{codigo, seccional, circunscripcion, municipio, numero_local, ubicacion}]
let porCodigo = new Map(); // codigo -> [mesas]
let SECCIONALES = new Set();

let coordMesa = new Map(); // telefono(digits) -> [{codigo, municipio, seccional, nombre}]
let coordSec = new Map();   // telefono(digits) -> {seccional, nombre, circunscripcion, municipio}

function normalizaTel(t) { return String(t || '').replace(/\D/g, ''); }
function norm(v) { return String(v || '').toUpperCase().trim(); }

function cargar() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'mesas.json'), 'utf8'));
    mesas = Array.isArray(m) ? m : (m.mesas || []);
  } catch (e) { mesas = []; }
  porCodigo = new Map();
  SECCIONALES.clear();
  mesas.forEach(me => {
    me.codigo = Number(me.codigo);
    me.seccional = norm(me.seccional);
    me.circunscripcion = norm(me.circunscripcion || me.seccional);
    if (!porCodigo.has(me.codigo)) porCodigo.set(me.codigo, []);
    porCodigo.get(me.codigo).push(me);
    if (me.seccional) SECCIONALES.add(me.seccional);
  });
}

// Inyectado desde sheets.cargarCoordinadores() (fuente: PRECONTEO Z/AA + SECCIONALES)
function setCoordinadores({ coordMesa: cm = [], coordSec: cs = [] } = {}) {
  coordMesa = new Map();
  coordSec = new Map();
  cm.forEach(c => coordMesa.set(normalizaTel(c.telefono), c.mesas.map(me => ({ ...me, nombre: me.nombre || '' }))));
  cs.forEach(c => coordSec.set(normalizaTel(c.telefono), { seccional: norm(c.seccional), nombre: c.nombre || '', circunscripcion: norm(c.circunscripcion), municipio: c.municipio || '' }));
}

function getMesasPorCodigo(codigo) { return porCodigo.get(Number(codigo)) || []; }

function getMesaExacta(codigo, { seccional, numero_local, municipio } = {}) {
  const candidatas = getMesasPorCodigo(codigo);
  if (candidatas.length === 0) return null;
  const sec = seccional ? norm(seccional) : null;
  const mun = municipio ? norm(municipio) : null;
  const filtro = candidatas.filter(me =>
    (!sec || me.seccional === sec) &&
    (!mun || me.municipio === mun) &&
    (numero_local === undefined || Number(me.numero_local) === Number(numero_local)));
  if (filtro.length >= 1) return filtro[0];
  return candidatas[0];
}

function mesaEnSeccional(mesa, seccional) {
  return mesa && norm(mesa.seccional) === norm(seccional);
}

const lidMap = new Map(); // lid -> phone

// Devuelve { tipo:'mesa'|'seccional', telefono, mesas?, seccional? } o null
function isTelefonoAutorizado(telefono, seccionalFiltro = null) {
  const t = normalizaTel(telefono);
  
  // 1. Coincidencia directa por teléfono o LID mapeado
  const mapped = lidMap.get(t) || t;
  if (coordMesa.has(mapped)) return { tipo: 'mesa', telefono: mapped, mesas: coordMesa.get(mapped) };
  if (coordSec.has(mapped)) return { tipo: 'seccional', telefono: mapped, seccional: coordSec.get(mapped).seccional };

  // 2. Si viene de un LID (ID largo > 12 dígitos) y hay coordinadores registrados en esa seccional
  if (t.length > 12 && seccionalFiltro) {
    const secNorm = norm(seccionalFiltro);
    
    // Buscar en coordinadores seccionales
    for (const [tel, cs] of coordSec) {
      if (cs.seccional === secNorm) {
        lidMap.set(t, tel);
        return { tipo: 'seccional', telefono: tel, seccional: cs.seccional };
      }
    }
    
    // Buscar en coordinadores de mesa de esa seccional
    for (const [tel, cmList] of coordMesa) {
      if (cmList.some(m => norm(m.seccional) === secNorm)) {
        lidMap.set(t, tel);
        return { tipo: 'mesa', telefono: tel, mesas: cmList };
      }
    }
  }

  return null;
}

function getCoordinadorSeccional(seccional) {
  for (const [, v] of coordSec) if (v.seccional === norm(seccional)) return v;
  return null;
}
function mesasDeSeccional(seccional) {
  const s = norm(seccional); const out = [];
  mesas.forEach(m => { if (m.seccional === s) out.push(m); });
  return out;
}

function seccionales() { return [...SECCIONALES]; }
function totalMesas() { return mesas.length; }

module.exports = {
  cargar, setCoordinadores, normalizaTel, norm,
  getMesasPorCodigo, getMesaExacta, mesaEnSeccional,
  isTelefonoAutorizado, getCoordinadorSeccional, mesasDeSeccional,
  seccionales, totalMesas,
  _estado: () => ({ mesas: mesas.length, seccionales: [...SECCIONALES], coordMesa: coordMesa.size, coordSec: coordSec.size }),
};
