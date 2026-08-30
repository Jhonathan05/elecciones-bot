'use strict';
// flows.js — máquina de estados conversacional (pura, sin I/O directo).
// El contexto `ctx` inyecta: getSession, saveSession, clearSession, getSeccionalDeInstancia,
// isCerrado, maestro (getMesaExacta, mesaEnSeccional, getMesasPorCodigo), sheets (escritores), logger.
// handle(phone, text, ctx, instance) -> string (respuesta para el usuario).

const V = require('./validators');

const MOMENTOS = { '1': 'instalacion', '2': 'participacion', '3': 'acta021' };
const NOMBRE_MOMENTO = { instalacion: 'Instalación', participacion: 'Participación', acta021: 'Acta 021' };

const ORDEN = {
  instalacion: ['jurados', 'kit', 'sillas', 'mesa', 'obs'],
  acta021: ['plancha1', 'plancha2', 'plancha3', 'plancha4', 'plancha5', 'blanco', 'nulos', 'noMarcados', 'total', 'incinerados', 'obs'],
};
const PREGUNTA = {
  jurados: '🔢 Jurados presentes (0 a 3):',
  kit: '📦 Kit electoral (Recibido / No Recibido):',
  sillas: '🪑 Sillas (Completas / No Completas):',
  mesa: '🗳️ Mesa física (Está / No Está):',
  obs: '📝 Observaciones (opcional, escribe "-" si no aplica):',
  plancha1: '🟦 Votos Plancha 1:', plancha2: '🟦 Votos Plancha 2:', plancha3: '🟦 Votos Plancha 3:',
  plancha4: '🟦 Votos Plancha 4:', plancha5: '🟦 Votos Plancha 5:',
  blanco: '⚪ Votos en blanco:', nulos: '🚫 Votos nulos:', noMarcados: '⬜ Votos no marcados:',
  total: '🔢 Total de votos de la mesa (sufragantes):',
  incinerados: '🔥 Votos incinerados (0 si ninguno):',
};

function norm(v) { return String(v || '').toUpperCase().trim(); }
function menu() {
  return `Hola. Soy el bot de reporte electoral. Elige el momento a diligenciar:
1️⃣ Instalación
2️⃣ Participación (parciales)
3️⃣ Acta 021 (preconteo)
Responde con el número. (Escribe AYUDA o CANCELAR en cualquier momento.)`;
}
function ayuda() {
  return `Comandos:
• 1 / 2 / 3  -> elegir momento
• CANCELAR   -> borrar la conversación actual
• CORREGIR   -> volver a ingresar los datos de la mesa actual
• AYUDA     -> este mensaje

Cada dato se valida al escribirlo. Al final verás un resumen y deberás confirmar con "SI".`;
}

function validarCampo(campo, texto) {
  switch (campo) {
    case 'jurados': return V.validarJurados(texto);
    case 'kit': return V.validarKit(texto);
    case 'sillas': return V.validarSillas(texto);
    case 'mesa': return V.validarMesa(texto);
    case 'obs': return V.validarObs(texto);
    case 'blanco': case 'nulos': case 'noMarcados': case 'incinerados':
      return V.validarSufragantes(texto);
    case 'total': return V.validarTotal(texto);
    case 'plancha1': case 'plancha2': case 'plancha3': case 'plancha4': case 'plancha5':
      return V.validarPlancha(texto, parseInt(campo.replace('plancha', ''), 10));
  }
  return { ok: false, msg: 'Campo no reconocido.' };
}

function siguienteTrasMesa(session, ctx) {
  if (session.momento === 'participacion') return 'part_rep';
  session.campo = ORDEN[session.momento][0];
  return session.momento + '_' + session.campo;
}

function resumen(session) {
  const b = session.borrador; const m = session.mesa; const mom = NOMBRE_MOMENTO[session.momento];
  let lines = [`*Resumen ${mom} — Mesa ${m} (${session.seccional})*`];
  if (session.momento === 'instalacion') {
    lines.push(`Jurados: ${b.jurados}`, `Kit: ${b.kitElectoral}`, `Sillas: ${b.sillas}`, `Mesa: ${b.mesa}`,
      `Observaciones: ${b.observaciones || '-'}`);
    lines.push(V.instaladaOK(b) ? '✔ Instalada: SÍ' : '⚠ Instalada: NO (faltan requisitos)');
  } else if (session.momento === 'participacion') {
    for (const k of ['1', '2', '3']) {
      if (b[k]) lines.push(`Boletín ${k}: ${b[k].sufragantes} sufragantes${b[k].observaciones ? ' (' + b[k].observaciones + ')' : ''}`);
    }
  } else if (session.momento === 'acta021') {
    for (let i = 1; i <= 5; i++) lines.push(`Plancha ${i}: ${b['plancha' + i]}`);
    lines.push(`Blanco: ${b.blanco}`, `Nulos: ${b.nulos}`, `No marcados: ${b.noMarcados}`, `Total: ${b.totalVotosMesa}`, `Incinerados: ${b.incinerados}`);
    lines.push(`Otras constancias: ${b.otrasConstancias || '-'}`);
    const desc = V.calcularCuadre(b);
    lines.push(desc === 0 ? '✔ Cuadra' : `⚠ DESCUADRE de ${desc} voto(s)`);
  }
  lines.push('\n¿Confirmas el envío? Responde SI o NO.');
  return lines.join('\n');
}

function escribir(session, ctx) {
  const b = session.borrador;
  if (session.momento === 'instalacion') {
    return ctx.sheets.escribirInstalacion(session.mesa, session.seccional, session.municipio, {
      jurados: b.jurados, kitElectoral: b.kitElectoral, sillas: b.sillas, mesa: b.mesa, observaciones: b.observaciones,
    }, ctx);
  }
  if (session.momento === 'participacion') {
    return ctx.sheets.escribirParticipacion(session.mesa, session.seccional, session.municipio, b, ctx);
  }
  if (session.momento === 'acta021') {
    return ctx.sheets.escribirActa021(session.mesa, session.seccional, session.municipio, {
      plancha1: b.plancha1, plancha2: b.plancha2, plancha3: b.plancha3, plancha4: b.plancha4, plancha5: b.plancha5,
      blanco: b.blanco, nulos: b.nulos, noMarcados: b.noMarcados, totalVotosMesa: b.totalVotosMesa,
      incinerados: b.incinerados, otrasConstancias: b.otrasConstancias,
    }, ctx);
  }
  return { ok: false, msg: 'Momento desconocido' };
}

async function handle(phone, rawText, ctx, instance) {
  const text = String(rawText || '').trim();
  const lower = text.toLowerCase();

  if (lower === 'cancelar') { ctx.clearSession(phone); return 'Operación cancelada. Envía cualquier mensaje para empezar de nuevo.'; }
  if (lower === 'ayuda') return ayuda();
  if (lower === 'corregir') {
    const s = ctx.getSession(phone);
    if (!s || !s.momento) return 'No hay datos que corregir. Elige un momento (1/2/3).';
    s.borrador = {}; s.campo = ORDEN[s.momento][0]; s.paso = s.momento + '_' + s.campo;
    ctx.saveSession(phone, s);
    return `Vamos a reingresar. ${PREGUNTA[s.campo]}`;
  }

  let session = ctx.getSession(phone);

  if (!session) {
    const seccional = ctx.getSeccionalDeInstancia(instance);
    if (!seccional) return '⛔ Este número no está asociado a una seccional. Contacta al administrador.';
    if (ctx.isCerrado()) return '🔒 La jornada está cerrada. Las correcciones deben hacerse directamente en el documento de Drive.';
    const coord = ctx.maestro.isTelefonoAutorizado(phone);
    if (!coord) return '⛔ Este número no está autorizado para reportar. Solicita asignación al administrador.';
    session = { paso: 'menu', momento: null, seccional, instance, mesa: null, municipio: null, borrador: {}, campo: null, correccion: false, coordinador: coord };
    ctx.saveSession(phone, session);
    return handle(phone, text, ctx, instance);
  }

  // --- MENÚ ---
  if (session.paso === 'menu') {
    const momento = MOMENTOS[text];
    if (!momento) return 'Opción no válida. Responde 1, 2 o 3.\n' + menu();
    session.momento = momento;
    session.paso = 'mesa';
    ctx.saveSession(phone, session);
    return `🆔 Código de mesa (ej: 53):`;
  }

  // --- MESA ---
  if (session.paso === 'mesa') {
    const codigo = Number(text);
    if (!Number.isInteger(codigo) || codigo <= 0) return 'Código inválido. Envía el número de mesa (ej: 53).';
    const candidatas = ctx.maestro.getMesasPorCodigo(codigo);
    if (candidatas.length === 0) return `No existe la mesa ${codigo}. Verifica el código.`;
    const enSec = candidatas.filter(me => ctx.maestro.mesaEnSeccional(me, session.seccional));
    const pool = enSec.length ? enSec : candidatas;
    // Filtrar por asignación del coordinador
    const coord = session.coordinador;
    let poolFinal = pool;
    if (coord.tipo === 'mesa') {
      poolFinal = pool.filter(me => coord.mesas.some(m =>
        m.codigo === codigo && norm(m.municipio) === norm(me.municipio) && norm(m.seccional) === norm(me.seccional)));
      if (poolFinal.length === 0) return `⛔ No estás asignado a la mesa ${codigo}. Solicita asignación al administrador.`;
    } else if (!enSec.length) {
      return `⛔ La mesa ${codigo} no pertenece a tu seccional.`;
    }
    if (poolFinal.length > 1) {
      session.mesa = codigo;
      session.candidatas = poolFinal.map(me => me.municipio);
      session.paso = 'mesa_mun';
      ctx.saveSession(phone, session);
      return `La mesa ${codigo} vota por varios municipios. ¿Municipio por el que vota?\n` + poolFinal.map(me => '• ' + me.municipio).join('\n');
    }
    session.mesa = codigo;
    session.municipio = poolFinal[0].municipio;
    session.paso = siguienteTrasMesa(session, ctx);
    ctx.saveSession(phone, session);
    return session.paso === 'part_rep' ? '🔢 Número de boletín (1, 2 o 3):' : PREGUNTA[session.campo];
  }
  if (session.paso === 'mesa_mun') {
    const mun = text.toUpperCase();
    const found = session.candidatas.find(m => String(m).toUpperCase() === mun) ||
      session.candidatas.find(m => String(m).toUpperCase().includes(mun));
    if (!found) return 'Municipio no encontrado. Escribe uno de:\n' + session.candidatas.map(m => '• ' + m).join('\n');
    const me = ctx.maestro.getMesaExacta(session.mesa, { seccional: session.seccional, municipio: found });
    if (session.coordinador.tipo === 'mesa') {
      const ok = session.coordinador.mesas.some(m =>
        m.codigo === session.mesa && norm(m.municipio) === norm(me.municipio) && norm(m.seccional) === norm(me.seccional));
      if (!ok) return `⛔ No estás asignado a la mesa ${session.mesa} (${found}).`;
    }
    session.municipio = me.municipio;
    session.paso = siguienteTrasMesa(session, ctx);
    ctx.saveSession(phone, session);
    return session.paso === 'part_rep' ? '🔢 Número de boletín (1, 2 o 3):' : PREGUNTA[session.campo];
  }

  // --- PARTICIPACIÓN (dinámica por boletines) ---
  if (session.paso === 'part_rep') {
    const r = V.validarNumeroReporte(text);
    if (!r.ok) return r.msg + ' 🔢 Número de boletín (1, 2 o 3):';
    const num = r.value;
    const anteriores = session.borrador;
    const seq = V.validarSecuenciaParticipacion(anteriores, num);
    if (!seq.ok) return seq.msg + ' 🔢 Número de boletín:';
    session._rep = num;
    session.paso = 'part_suf';
    ctx.saveSession(phone, session);
    return `👥 Sufragantes del boletín ${num}:`;
  }
  if (session.paso === 'part_suf') {
    const s = V.validarSufragantes(text);
    if (!s.ok) return s.msg + ' 👥 Sufragantes:';
    const num = session._rep;
    const dec = V.validarNoDecrecimiento(session.borrador, num, s.value);
    if (!dec.ok) return dec.msg + ' 👥 Sufragantes del boletín ' + num + ':';
    session._suf = s.value;
    session.paso = 'part_obs';
    ctx.saveSession(phone, session);
    return '📝 Observaciones de este boletín (escribe "-" si no aplica):';
  }
  if (session.paso === 'part_obs') {
    const o = text === '-' ? '' : text;
    const r = V.validarObs(o);
    if (!r.ok) return r.msg;
    session.borrador[session._rep] = { sufragantes: session._suf, observaciones: r.value };
    session.paso = 'part_mas';
    ctx.saveSession(phone, session);
    return '¿Reportar otro boletín? (SI / NO):';
  }
  if (session.paso === 'part_mas') {
    if (lower === 'si' || lower === 'sí' || lower === 's') {
      session.paso = 'part_rep'; ctx.saveSession(phone, session);
      return '🔢 Número de boletín (1, 2 o 3):';
    }
    if (lower === 'no' || lower === 'n') {
      session.paso = 'confirm'; ctx.saveSession(phone, session);
      return resumen(session);
    }
    return 'Responde SI o NO.';
  }

  // --- INSTALACIÓN y ACTA 021 (campo a campo) ---
  if (session.paso && (session.paso.startsWith('instalacion_') || session.paso.startsWith('acta021_'))) {
    const campo = session.campo;
    const vr = validarCampo(campo, text);
    if (!vr.ok) return vr.msg + '\n' + PREGUNTA[campo];
    // mapear a borrador
    if (session.momento === 'instalacion') {
      if (campo === 'jurados') session.borrador.jurados = vr.value;
      else if (campo === 'kit') session.borrador.kitElectoral = vr.value;
      else if (campo === 'sillas') session.borrador.sillas = vr.value;
      else if (campo === 'mesa') session.borrador.mesa = vr.value;
      else if (campo === 'obs') session.borrador.observaciones = (text === '-' ? '' : vr.value);
    } else {
      if (campo === 'obs') session.borrador.otrasConstancias = (text === '-' ? '' : vr.value);
      else if (campo === 'incinerados') session.borrador.incinerados = vr.value;
      else if (campo === 'total') session.borrador.totalVotosMesa = vr.value;
      else session.borrador[campo] = vr.value;
    }
    const orden = ORDEN[session.momento];
    const idx = orden.indexOf(campo);
    if (idx < orden.length - 1) {
      session.campo = orden[idx + 1];
      session.paso = session.momento + '_' + session.campo;
      ctx.saveSession(phone, session);
      return PREGUNTA[session.campo];
    }
    session.paso = 'confirm';
    ctx.saveSession(phone, session);
    return resumen(session);
  }

  // --- CONFIRMAR ---
  if (session.paso === 'confirm') {
    if (lower === 'si' || lower === 'sí' || lower === 's') {
      const resp = await escribir(session, ctx);
      if (!resp.ok) return '⚠ No se pudo guardar: ' + resp.msg + '. Corrige con CORREGIR o CANCELAR.';
      ctx.clearSession(phone);
      return `✅ ${NOMBRE_MOMENTO[session.momento]} de la mesa ${session.mesa} registrada.` + (resp.alerta ? `\n${resp.alerta}` : '');
    }
    if (lower === 'no' || lower === 'n') {
      // reingresar desde el inicio del momento
      session.borrador = {}; session.campo = ORDEN[session.momento][0];
      session.paso = session.momento + '_' + session.campo;
      ctx.saveSession(phone, session);
      return 'Vamos a reingresar. ' + PREGUNTA[session.campo];
    }
    return 'Responde SI para confirmar o NO para corregir.';
  }

  return ayuda();
}

module.exports = { handle, menu, ayuda, _ORDEN: ORDEN };
