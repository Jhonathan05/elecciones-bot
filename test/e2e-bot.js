'use strict';
// test/e2e-bot.js — E2E real: webhook → flows → sheets → Excel (3 momentos)
process.env.BOT_CONFIG_DIR = require('path').join(__dirname, '..', 'config');

const fs = require('fs');
const path = require('path');
const X = require('xlsx');

const sheets = require('../src/sheets');
const state = require('../src/state');
const maestro = require('../src/maestro');

const BASE_URL = 'http://localhost:8090';
const INSTANCE = 'chaparral';
const COORD_PHONE = '573001112244';
const SEC_PHONE = '573001112233';
const SECCIONAL = 'CHAPARRAL';

async function loginAdmin() {
  const res = await fetch(`${BASE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', password: 'admin' })
  });
  if (!res.ok) throw new Error('Login admin falló: ' + res.status);
  const data = await res.json();
  return data.token;
}

async function setupPrecondition(token) {
  // 1) Buscar una mesa CHAPARRAL de fila única (el pre-seed ya se hizo antes)
  maestro.cargar();
  const mesasCH = maestro.mesasDeSeccional(SECCIONAL);
  const singles = mesasCH.filter(m => maestro.getMesasPorCodigo(m.codigo).length === 1);
  if (singles.length < 2) throw new Error('No hay suficientes mesas CHAPARRAL de fila única');
  const MESA = singles[0].codigo;
  const MUN = singles[0].municipio;
  console.log(`Mesa de prueba (ya pre-seed): ${MESA} (${MUN})`);
  return { MESA, MUN };
}

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:8090/health');
      const j = await res.json();
      if (j.status === 'healthy') return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Health no pasó a healthy en 30s');
}

async function postWebhook(text, phone = COORD_PHONE) {
  const payload = {
    event: 'MESSAGES_UPSERT',
    instance: INSTANCE,
    data: {
      key: { remoteJid: `${phone}@c.us`, fromMe: false },
      message: { conversation: text }
    }
  };
  const res = await fetch('http://localhost:8090/webhook/evolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: res.status, body: await res.text() };
}

async function runMoment(token, moment, mesa, messages, mun) {
  console.log(`\n=== Momento: ${moment} (mesa ${mesa}) ===`);
  // Login para obtener token fresco si expira
  const freshToken = await loginAdmin();
  const auth = { 'Content-Type': 'application/json', 'x-admin-token': freshToken };

  for (const [i, msg] of messages.entries()) {
    console.log(`  → Enviando: "${msg}"`);
    const { status, body } = await postWebhook(msg);
    if (status !== 500 && status !== 200) {
      console.warn(`  ⚠ Webhook status ${status}: ${body}`);
    }
    // Pequeña pausa para que el bot procese
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`  ✓ ${messages.length} mensajes enviados`);
}

async function verifyExcel(token, mesa, moment) {
  console.log(`\n=== Verificando Excel: ${moment} (mesa ${mesa}) ===`);
  const res = await fetch(`${BASE_URL}/admin/descargar-trabajo`, {
    headers: { 'x-admin-token': token }
  });
  if (!res.ok) throw new Error('Descargar trabajo falló: ' + res.status);
  const buf = await res.arrayBuffer();
  const wb = X.read(buf);
  
  const sheetName = moment === 'instalacion' ? 'INSTALACION' :
                    moment === 'participacion' ? 'PARTICIPACION' : 'PRECONTEO';
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Hoja ${sheetName} no encontrada`);
  
  const rows = X.utils.sheet_to_json(ws, { header: 1, defval: undefined, blankrows: false });
  const header = rows[0];
  const headerMap = {};
  header.forEach((h, i) => headerMap[h] = i);
  
  const dataRows = rows.slice(1);
  const targetRow = dataRows.find(r => 
    Number(r[headerMap['CÓDIGO MESA']]) === mesa &&
    String(r[headerMap['SECCIONAL UBICACION MESA']] || '').toUpperCase() === 'CHAPARRAL'
  );
  
  if (!targetRow) throw new Error(`Mesa ${mesa} no encontrada en ${sheetName}`);
  
  console.log('  Fila encontrada, verificando campos...');
  
  if (moment === 'instalacion') {
    const checks = {
      'JURADOS': 3,
      'KIT ELECTORAL': 'Recibido',
      'SILLAS': 'Completas',
      'MESA FÍSICA': 'Está',
      'INSTALADA': 'SI',
      'ALERTA': 'OK',
      'REPORTADO_POR': '573001112244'
    };
    for (const [col, expected] of Object.entries(checks)) {
      const val = targetRow[headerMap[col]];
      if (val !== expected) throw new Error(`${col}: esperado "${expected}", got "${val}"`);
      console.log(`  ✔ ${col} = ${val}`);
    }
  } else if (moment === 'participacion') {
    if (targetRow[headerMap['TOTAL SUFRAGANTES']] !== 250) throw new Error('TOTAL SUFRAGANTES no es 250');
    console.log(`  ✔ TOTAL SUFRAGANTES = 250`);
  } else if (moment === 'acta021') {
    if (targetRow[headerMap['CONTROL']] !== 'SI') throw new Error('CONTROL no es SI');
    if (targetRow[headerMap['DESCUADRE']] !== 0) throw new Error('DESCUADRE no es 0');
    console.log(`  ✔ CONTROL = SI, DESCUADRE = 0`);
  }
  console.log(`  ✅ ${moment} verificado OK`);
}

async function main() {
  console.log('=== E2E Bot WhatsApp → Sheets (3 momentos) ===\n');
  
  try {
    const token = await loginAdmin();
    console.log('Login admin OK');
    
    const { MESA, MUN } = await setupPrecondition(token);
    
    // === MOMENTO 1: INSTALACIÓN ===
    await runMoment(token, 'instalacion', MESA, [
      'hola',
      '1',                    // Menú: Instalación
      '1',                    // Confirmar datos de la mesa (auto-seleccionada)
      '3', 'Recibido', 'Completas', 'Está', '-', 'si'  // Campos + confirmar
    ], MUN);
    await verifyExcel(token, MESA, 'instalacion');
    
    // === MOMENTO 2: PARTICIPACIÓN ===
    await runMoment(token, 'participacion', MESA, [
      'hola',
      '2',                    // Menú: Participación
      '1',                    // Confirmar datos de la mesa (auto-seleccionada)
      '1', '100', '-', 'si',  // Boletín 1: 100 sufragantes, sin obs
      '2', '150', '-', 'no',  // Boletín 2: 150 sufragantes, sin obs, terminar
      'si'                    // Confirmar
    ], MUN);
    await verifyExcel(token, MESA, 'participacion');
    
    // === MOMENTO 3: ACTA 021 ===
    await runMoment(token, 'acta021', MESA, [
      'hola',
      '3',                    // Menú: Acta 021
      '1',                    // Confirmar datos de la mesa (auto-seleccionada)
      '100', '50', '10', '5', '2',  // Planchas 1-5
      '0', '0', '0', '167', '0', '-', 'si', // Blanco, nulos, noMarcados, total, incinerados, obs, confirmar
      '-'                     // Finalizar paso de foto de evidencia
    ], MUN);
    await verifyExcel(token, MESA, 'acta021');
    
    console.log('\n🎉 E2E COMPLETO: 3 momentos inyectados y verificados en Excel');
  } catch (e) {
    console.error('\n❌ E2E FALLÓ:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();