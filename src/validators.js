'use strict';
// validators.js — validación de los campos de los 3 momentos (misma semántica que el app).
// Cada función devuelve { ok:true, value } o { ok:false, msg }.

function entero(str, min, max, nombre) {
  const n = Number(str);
  if (!Number.isInteger(n)) return { ok: false, msg: `✗ ${nombre} debe ser un número entero.` };
  if (n < min || n > max) return { ok: false, msg: `✗ ${nombre} debe estar entre ${min} y ${max}.` };
  return { ok: true, value: n };
}

function enumEn(str, opcionesMap, nombre) {
  const v = String(str || '').trim().toLowerCase();
  
  // Si el usuario envía un número de opción ("1" o "2")
  if (opcionesMap[v]) {
    return { ok: true, value: opcionesMap[v] };
  }
  
  // Si envía el texto directo ("recibido", "completas", etc.)
  for (const [numKey, textVal] of Object.entries(opcionesMap)) {
    if (textVal.toLowerCase() === v) {
      return { ok: true, value: textVal };
    }
  }

  const opcionesTexto = Object.entries(opcionesMap).map(([k, val]) => `${k}️⃣ ${val}`).join('\n');
  return { 
    ok: false, 
    msg: `⚠️ La opción "${str}" no corresponde con la lista.\nPor favor responde seleccionando un número de la lista:\n${opcionesTexto}` 
  };
}

function textoOpcional(str, max, nombre) {
  const v = String(str || '').trim();
  if (v.length > max) return { ok: false, msg: `⚠️ ${nombre} máximo ${max} caracteres.` };
  return { ok: true, value: v };
}

// --- Instalación ---
const KIT_MAP = { '1': 'Recibido', '2': 'No Recibido' };
const SILLAS_MAP = { '1': 'Completas', '2': 'No Completas' };
const MESA_MAP = { '1': 'Está', '2': 'No Está' };

function validarJurados(s) { 
  const r = entero(s, 0, 3, 'Jurados'); 
  if (!r.ok) r.msg = `⚠️ Número de jurados inválido. Ingresa un número entre 0 y 3.`;
  return r;
}
function validarKit(s) { return enumEn(s, KIT_MAP, 'Kit electoral'); }
function validarSillas(s) { return enumEn(s, SILLAS_MAP, 'Sillas'); }
function validarMesa(s) { return enumEn(s, MESA_MAP, 'Mesa física'); }
function validarObs(s) { return textoOpcional(s, 500, 'Observaciones'); }

function instaladaOK(b) {
  return b.jurados === 3 && b.kitElectoral === 'Recibido' && b.sillas === 'Completas' && b.mesa === 'Está';
}

// --- Participación ---
function validarNumeroReporte(s) { return entero(s, 1, 3, 'Número de reporte'); }
function validarSufragantes(s) { return entero(s, 0, 1000000, 'Sufragantes'); }

function validarSecuenciaParticipacion(anteriores, numero) {
  // requiere que exista el reporte numero-1
  if (numero > 1 && (anteriores[numero - 1] === undefined)) {
    return { ok: false, msg: `✗ Primero debes reportar el boletín ${numero - 1}.` };
  }
  return { ok: true };
}

function validarNoDecrecimiento(anteriores, numero, sufragantes) {
  const prev = anteriores[numero - 1];
  if (prev !== undefined && sufragantes < prev) {
    return { ok: false, msg: `✗ Los sufragantes del boletín ${numero} (${sufragantes}) no pueden ser menores que el boletín ${numero - 1} (${prev}).` };
  }
  return { ok: true };
}

// --- Acta 021 ---
function validarPlancha(s, i) { return entero(s, 0, 1000000, `Plancha ${i}`); }
function validarTotal(s) { return entero(s, 0, 1000000, 'Total de votos de la mesa'); }

function calcularCuadre(b) {
  const suma = b.plancha1 + b.plancha2 + b.plancha3 + b.plancha4 + b.plancha5 +
    b.blanco + b.nulos + b.noMarcados;
  return suma - b.totalVotosMesa; // 0 = cuadra
}

function validarCuadre021(b) {
  const desc = calcularCuadre(b);
  if (desc !== 0) {
    return { ok: false, descuadre: desc, msg: `⚠ Descuadre de ${desc} voto(s): Σplanchar+blanco+nulos+no marcados (${suma(b)}) ≠ total (${b.totalVotosMesa}).` };
  }
  return { ok: true, descuadre: 0 };
}

function suma(b) {
  return b.plancha1 + b.plancha2 + b.plancha3 + b.plancha4 + b.plancha5 + b.blanco + b.nulos + b.noMarcados;
}

module.exports = {
  KIT_MAP, SILLAS_MAP, MESA_MAP,
  KIT: Object.values(KIT_MAP), SILLAS: Object.values(SILLAS_MAP), MESA: Object.values(MESA_MAP),
  validarJurados, validarKit, validarSillas, validarMesa, validarObs, instaladaOK,
  validarNumeroReporte, validarSufragantes, validarSecuenciaParticipacion, validarNoDecrecimiento,
  validarPlancha, validarTotal, calcularCuadre, validarCuadre021, suma,
};
