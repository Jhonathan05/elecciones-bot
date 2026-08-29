'use strict';
// scripts/importar-datos.js — CLI: lee el catálogo y las líneas desde el Google Sheet
// (fuente única) y los vuelca a config/mesas.json + bot-state.db (líneas).
// Requiere EVOLUTION_API_KEY, GOOGLE_CREDENTIALS_JSON y GOOGLE_SHEET_ID en .env.
require('dotenv').config();
const sheets = require('../src/sheets');
const maestro = require('../src/maestro');

(async () => {
  try {
    await sheets.init();
    const r = await sheets.importarDesdeSheet();
    maestro.cargar();
    maestro.setCoordinadores(sheets.getCoordinadores());
    console.log('Importación completa:', JSON.stringify(r));
    console.log('Coordinadores:',
      sheets.getCoordinadores().coordMesa.length, 'de mesa,',
      sheets.getCoordinadores().coordSec.length, 'seccionales.');
  } catch (e) {
    console.error('Error de importación:', e.message);
    process.exit(1);
  }
})();
