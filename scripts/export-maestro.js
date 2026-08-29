'use strict';
// scripts/export-maestro.js — extrae catálogo de mesas y coordinadores desde la DB del app
// y los vuelca a config/mesas.json y config/coordinadores.json para que el bot funcione
// aunque el app esté caído (scoping por seccional + whitelist de teléfonos).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const APP_DB = process.env.APP_DB_PATH ||
  'E:\\jhonathan\\Open\\elecciones-fnc\\data\\elecciones.db';
const OUT_DIR = path.join(__dirname, '..', 'config');

function limpiaTel(t) {
  if (!t) return '';
  return String(t).replace(/\D/g, '');
}

function main() {
  if (!fs.existsSync(APP_DB)) { console.error('No encontré la DB del app en', APP_DB); process.exit(1); }
  const db = new Database(APP_DB, { readonly: true, fileMustExist: true });
  const row = db.prepare('SELECT data FROM snapshot LIMIT 1').get();
  const data = JSON.parse(row.data);
  const mesas = (data.mesas || []).map(m => ({
    codigo: m.codigo,
    seccional: m.seccional,
    circunscripcion: m.circunscripcion || m.seccional,
    numero_local: m.numero_local,
    municipio: m.municipio_vota || m.municipio_ubicacion,
    ubicacion: m.ubicacion,
  }));
  const coordinadores = (data.coordinadores || []).map(c => ({
    telefono: limpiaTel((c.celulares && c.celulares[0]) || c.contacto || ''),
    seccional: c.seccional,
    mesas_asignadas: c.mesas_asignadas || [],
  })).filter(c => c.telefono);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'mesas.json'), JSON.stringify(mesas, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'coordinadores.json'), JSON.stringify(coordinadores, null, 2));
  console.log(`Exportado: ${mesas.length} mesas, ${coordinadores.length} coordinadores con teléfono -> ${OUT_DIR}`);
}

main();
