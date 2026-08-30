'use strict';
// test/logic.test.js — prueba del flujo conversacional y validadores sin dependencias externas.
process.env.BOT_CONFIG_DIR = require('path').join(__dirname, '..', 'config');

const assert = require('assert');
const maestro = require('../src/maestro');
const V = require('../src/validators');
const flows = require('../src/flows');

maestro.cargar();
assert.ok(maestro.totalMesas() > 0, 'maestro cargado');

// Mesa real de CHAPARRAL (fila única) para las pruebas
const MESA = maestro.mesasDeSeccional('CHAPARRAL').map(x => x.codigo).filter(c => maestro.getMesasPorCodigo(c).length === 1)[0];
assert.ok(MESA, 'mesa de CHAPARRAL disponible');
const COD = String(MESA);

// Autorizar el teléfono de prueba como coordinador SECCIONAL de CHAPARRAL
maestro.setCoordinadores({
  coordMesa: [],
  coordSec: [{ telefono: '573001112233', seccional: 'CHAPARRAL', nombre: 'Test', circunscripcion: 'CHAPARRAL', municipio: '' }],
});

// ---- store en memoria ----
function makeCtx(phone, instance) {
  const sesiones = {};
  const calls = [];
  return {
    _calls: calls,
    getSession: p => sesiones[p] || null,
    saveSession: (p, d) => { sesiones[p] = d; },
    clearSession: p => { delete sesiones[p]; },
    getSeccionalDeInstancia: inst => (inst === 'chaparral' ? 'CHAPARRAL' : (inst === 'oritega' ? 'ORTEGA' : null)),
    isCerrado: () => false,
    maestro,
    linea: instance, telefono: phone,
    sheets: {
      escribirInstalacion: (m, s, mun, d, ctx2) => { calls.push(['inst', m, d]); return { ok: true }; },
      escribirParticipacion: (m, s, mun, b, ctx2) => { calls.push(['part', m, b]); return { ok: true }; },
      escribirActa021: (m, s, mun, d, ctx2) => {
        const desc = V.calcularCuadre(d);
        calls.push(['acta021', m, d]);
        return desc === 0 ? { ok: true } : { ok: true, alerta: `⚠ Descuadre ${desc}` };
      },
    },
    logger: { log() {} },
  };
}

async function conversar(ctx, phone, instance, mensajes) {
  let last = '';
  for (const m of mensajes) last = await flows.handle(phone, m, ctx, instance);
  return last;
}

async function runTests() {
  // ---- 1) Acta 021 con cuadre correcto ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '3', COD, '100', '50', '10', '5', '2', '30', '7', '0', '204', '0', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'acta021' && c[1] === MESA), 'acta021 escrita para mesa ' + COD);
    const acta = ctx._calls.find(c => c[0] === 'acta021')[2];
    assert.strictEqual(acta.plancha1, 100); assert.strictEqual(acta.totalVotosMesa, 204);
    console.log('✔ Acta 021 (cuadre OK) escrita');
  }

  // ---- 2) Acta 021 con descuadre -> alerta, pero se confirma ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '3', COD, '100', '50', '10', '5', '2', '30', '7', '0', '300', '0', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'acta021'), 'acta021 descuadrada escrita');
    console.log('✔ Acta 021 (descuadre) escrita con alerta');
  }

  // ---- 3) Instalación completa ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '1', COD, '3', 'Recibido', 'Completas', 'Está', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'inst' && c[1] === MESA), 'instalacion escrita');
    console.log('✔ Instalación escrita');
  }

  // ---- 4) Participación con 2 boletines y secuencia ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '2', COD, '1', '100', '-', 'si', '2', '150', '-', 'no', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'part' && c[1] === MESA), 'participacion escrita');
    console.log('✔ Participación (2 boletines) escrita');
  }

  // ---- 5) Validadores ----
  assert.strictEqual(V.validarJurados('3').ok, true);
  assert.strictEqual(V.validarJurados('9').ok, false);
  assert.strictEqual(V.validarKit('Recibido').ok, true);
  assert.strictEqual(V.validarKit('x').ok, false);
  assert.strictEqual(V.instaladaOK({ jurados: 3, kitElectoral: 'Recibido', sillas: 'Completas', mesa: 'Está' }), true);
  assert.strictEqual(V.validarCuadre021({ plancha1: 1, plancha2: 0, plancha3: 0, plancha4: 0, plancha5: 0, blanco: 0, nulos: 0, noMarcados: 0, totalVotosMesa: 1 }).ok, true);
  assert.strictEqual(V.validarCuadre021({ plancha1: 1, blanco: 0, nulos: 0, noMarcados: 0, plancha2: 0, plancha3: 0, plancha4: 0, plancha5: 0, totalVotosMesa: 2 }).ok, false);
  assert.strictEqual(V.validarNoDecrecimiento({ 1: 100 }, 2, 90).ok, false);
  console.log('✔ Validadores OK');

  // ---- 6) Línea no asociada rechaza ----
  {
    const ctx = makeCtx('573009999999', 'desconocida');
    const r = await flows.handle('573009999999', 'hola', ctx, 'desconocida');
    assert.ok(/no está asociado/.test(r), 'línea desconocida rechazada');
    console.log('✔ Línea no asociada rechazada');
  }

  // ---- 7) Validación por asignación de coordinador de mesa ----
  {
    const mesasCH = maestro.mesasDeSeccional('CHAPARRAL').map(m => m.codigo);
    const singles = mesasCH.filter(c => maestro.getMesasPorCodigo(c).length === 1);
    assert.ok(singles.length >= 2, 'hay al menos 2 mesas de fila única en CHAPARRAL');
    const asignada = singles[0];
    const otra = singles[1];
    const munAsig = maestro.getMesasPorCodigo(asignada)[0].municipio;

    // Telefono autorizado SOLO para la mesa asignada
    maestro.setCoordinadores({
      coordMesa: [{ telefono: '573001112244', mesas: [{ codigo: asignada, municipio: munAsig, seccional: 'CHAPARRAL', nombre: 'M' }] }],
      coordSec: [{ telefono: '573001112233', seccional: 'CHAPARRAL', nombre: 'Test', circunscripcion: 'CHAPARRAL', municipio: '' }],
    });

    // Puede reportar su mesa asignada
    const ctxA = makeCtx('573001112244', 'chaparral');
    await conversar(ctxA, '573001112244', 'chaparral', [
      '3', String(asignada), '100', '50', '10', '5', '2', '30', '7', '0', '204', '0', '-', 'si',
    ]);
    assert.ok(ctxA._calls.some(c => c[0] === 'acta021'), 'coord mesa reporta su mesa asignada');

    // No puede reportar mesa ajena
    const ctxB = makeCtx('573001112244', 'chaparral');
    await flows.handle('573001112244', '3', ctxB, 'chaparral');
    const rB = await flows.handle('573001112244', String(otra), ctxB, 'chaparral');
    assert.ok(/No estás asignado/.test(rB), 'coord mesa rechazado en mesa ajena: ' + rB);
    console.log('✔ Validación de asignación coordinador de mesa OK');
  }

  console.log('\n✅ TODAS LAS PRUEBAS DE LÓGICA PASARON');
}

async function runTests() {
  // ---- 1) Acta 021 con cuadre correcto ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '3', COD, '100', '50', '10', '5', '2', '30', '7', '0', '204', '0', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'acta021' && c[1] === MESA), 'acta021 escrita para mesa ' + COD);
    const acta = ctx._calls.find(c => c[0] === 'acta021')[2];
    assert.strictEqual(acta.plancha1, 100); assert.strictEqual(acta.totalVotosMesa, 204);
    console.log('✔ Acta 021 (cuadre OK) escrita');
  }

  // ---- 2) Acta 021 con descuadre -> alerta, pero se confirma ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '3', COD, '100', '50', '10', '5', '2', '30', '7', '0', '300', '0', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'acta021'), 'acta021 descuadrada escrita');
    console.log('✔ Acta 021 (descuadre) escrita con alerta');
  }

  // ---- 3) Instalación completa ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '1', COD, '3', 'Recibido', 'Completas', 'Está', '-', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'inst' && c[1] === MESA), 'instalacion escrita');
    console.log('✔ Instalación escrita');
  }

  // ---- 4) Participación con 2 boletines y secuencia ----
  {
    const ctx = makeCtx('573001112233', 'chaparral');
    await conversar(ctx, '573001112233', 'chaparral', [
      '2', COD, '1', '100', '-', 'si', '2', '150', '-', 'no', 'si',
    ]);
    assert.ok(ctx._calls.some(c => c[0] === 'part' && c[1] === MESA), 'participacion escrita');
    console.log('✔ Participación (2 boletines) escrita');
  }

  // ---- 5) Validadores ----
  assert.strictEqual(V.validarJurados('3').ok, true);
  assert.strictEqual(V.validarJurados('9').ok, false);
  assert.strictEqual(V.validarKit('Recibido').ok, true);
  assert.strictEqual(V.validarKit('x').ok, false);
  assert.strictEqual(V.instaladaOK({ jurados: 3, kitElectoral: 'Recibido', sillas: 'Completas', mesa: 'Está' }), true);
  assert.strictEqual(V.validarCuadre021({ plancha1: 1, plancha2: 0, plancha3: 0, plancha4: 0, plancha5: 0, blanco: 0, nulos: 0, noMarcados: 0, totalVotosMesa: 1 }).ok, true);
  assert.strictEqual(V.validarCuadre021({ plancha1: 1, blanco: 0, nulos: 0, noMarcados: 0, plancha2: 0, plancha3: 0, plancha4: 0, plancha5: 0, totalVotosMesa: 2 }).ok, false);
  assert.strictEqual(V.validarNoDecrecimiento({ 1: 100 }, 2, 90).ok, false);
  console.log('✔ Validadores OK');

  // ---- 6) Línea no asociada rechaza ----
  {
    const ctx = makeCtx('573009999999', 'desconocida');
    const r = await flows.handle('573009999999', 'hola', ctx, 'desconocida');
    assert.ok(/no está asociado/.test(r), 'línea desconocida rechazada');
    console.log('✔ Línea no asociada rechazada');
  }

  // ---- 7) Validación por asignación de coordinador de mesa ----
  {
    const mesasCH = maestro.mesasDeSeccional('CHAPARRAL').map(m => m.codigo);
    const singles = mesasCH.filter(c => maestro.getMesasPorCodigo(c).length === 1);
    assert.ok(singles.length >= 2, 'hay al menos 2 mesas de fila única en CHAPARRAL');
    const asignada = singles[0];
    const otra = singles[1];
    const munAsig = maestro.getMesasPorCodigo(asignada)[0].municipio;

    // Telefono autorizado SOLO para la mesa asignada
    maestro.setCoordinadores({
      coordMesa: [{ telefono: '573001112244', mesas: [{ codigo: asignada, municipio: munAsig, seccional: 'CHAPARRAL', nombre: 'M' }] }],
      coordSec: [{ telefono: '573001112233', seccional: 'CHAPARRAL', nombre: 'Test', circunscripcion: 'CHAPARRAL', municipio: '' }],
    });

    // Puede reportar su mesa asignada
    const ctxA = makeCtx('573001112244', 'chaparral');
    await conversar(ctxA, '573001112244', 'chaparral', [
      '3', String(asignada), '100', '50', '10', '5', '2', '30', '7', '0', '204', '0', '-', 'si',
    ]);
    assert.ok(ctxA._calls.some(c => c[0] === 'acta021'), 'coord mesa reporta su mesa asignada');

    // No puede reportar mesa ajena
    const ctxB = makeCtx('573001112244', 'chaparral');
    await flows.handle('573001112244', '3', ctxB, 'chaparral');
    const rB = await flows.handle('573001112244', String(otra), ctxB, 'chaparral');
    assert.ok(/No estás asignado/.test(rB), 'coord mesa rechazado en mesa ajena: ' + rB);
    console.log('✔ Validación de asignación coordinador de mesa OK');
  }

  console.log('\n✅ TODAS LAS PRUEBAS DE LÓGICA PASARON');
}

runTests().catch(e => { console.error(e); process.exit(1); });