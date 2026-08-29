'use strict';
// importar-catalogo.js
// Genera la plantilla de contingencia (6 hojas) a partir de un ARCHIVO de
// catálogo completo de mesas (CSV, JSON u XLSX), sin depender del 3_PRECONTEO
// parcial de elecciones-fnc. Así el bot puede cubrir TODAS las mesas del universo.
//
// Uso:
//   node scripts/importar-catalogo.js <archivo.csv|json|xlsx> [--out salida.xlsx]
//
// Columnas reconocidas (insensibles a mayúsculas, acentos y espacios/guiones):
//   codigo_mesa        (numérico, requerido)
//   seccional          (requerido)
//   municipio_vota     (MUNICIPIO POR EL QUE VOTA; requerido; si falta se usa seccional)
//   municipio_ubicacion(opcional; por defecto = municipio_vota)
//   ubicacion          (opcional; por defecto = seccional)
//   departamento       (opcional; por defecto TOLIMA)
//   tipo_mesa          (opcional; por defecto CONTINGENCIA)
//   numero_mesa        (opcional; por defecto = codigo_mesa)
//   estimado_votos_2022(opcional; por defecto 0)
//   circunscripcion    (opcional)

const fs = require('fs');
const path = require('path');
const X = require('E:\\jhonathan\\Open\\elecciones-fnc\\node_modules\\xlsx');
const { buildWorkbook } = require('./build-template');

const SRC_OUT = 'E:\\jhonathan\\Open\\whatsapp-bot\\3_PRECONTEO 2022-PLANCHAS.xlsx';

function normHeader(h) {
  return String(h == null ? '' : h)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s_\-.]/g, '');
}
const ALIAS = {
  codigomesa: 9, codigo: 9, mesacodigo: 9,
  seccionalubicacionmesa: 2, seccional: 2,
  municipioporelquevota: 8, municipiovotacion: 8, municipiovota: 8,
  municipioubicacionmesa: 3, municipioubicacion: 3,
  ubicacion: 0, departamento: 1, tipomesa: 4, numeromesa: 5,
  estimadovotos2022: 6, estimado: 6, circunscripcionporlaquevota: 7, circunscripcion: 7,
};
const REQ = [9, 2]; // código, seccional

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function loadRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data) && data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0]).map(h => [normHeader(h), h]);
      return [headers.map(([, h]) => h)].concat(data.map(o => Object.keys(data[0]).map(k => o[k])));
    }
    if (Array.isArray(data) && Array.isArray(data[0])) return data;
    throw new Error('JSON debe ser array de objetos o array de arrays');
  }
  if (ext === '.csv') {
    const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
    const lines = text.split('\n').filter(l => l.length);
    return lines.map(parseCsvLine);
  }
  // xlsx
  const wb = X.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, defval: undefined, blankrows: false });
}

function rowsToSrc(rows) {
  const colOf = {};
  (rows[0] || []).forEach((h, i) => { const n = normHeader(h); if (ALIAS[n] !== undefined) colOf[ALIAS[n]] = i; });
  const out = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const s = new Array(19).fill(undefined);
    Object.keys(colOf).forEach(c => { s[c] = r[colOf[c]]; });
    if (s[9] === undefined || s[9] === '' || isNaN(Number(s[9]))) { skipped++; continue; }
    if (!s[2]) { skipped++; continue; }
    s[9] = Number(s[9]);
    if (!s[8]) s[8] = s[2];
    if (!s[3]) s[3] = s[8];
    if (!s[0]) s[0] = s[2];
    if (!s[1]) s[1] = 'TOLIMA';
    if (!s[4]) s[4] = 'CONTINGENCIA';
    if (!s[5]) s[5] = s[9];
    if (s[6] === undefined || s[6] === '') s[6] = 0;
    out.push(s);
  }
  return { src: out, skipped };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Uso: node scripts/importar-catalogo.js <archivo> [--out salida.xlsx]'); process.exit(1); }
  let file = args[0];
  let out = SRC_OUT;
  const oi = args.indexOf('--out');
  if (oi >= 0 && args[oi + 1]) out = args[oi + 1];
  if (!fs.existsSync(file)) { console.error('No existe:', file); process.exit(1); }

  const rows = loadRows(file);
  const { src, skipped } = rowsToSrc(rows);
  if (!src.length) { console.error('Ninguna mesa válida (requiere codigo_mesa + seccional). Filas omitidas:', skipped); process.exit(1); }

  const wb = buildWorkbook(src);
  X.writeFile(wb, out);
  console.log('Plantilla generada desde catálogo:', out);
  console.log('Mesas incluidas:', src.length, '| omitidas:', skipped);
}

if (require.main === module) main();

module.exports = { rowsToSrc, loadRows };
