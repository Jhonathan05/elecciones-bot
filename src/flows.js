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
  jurados: '🔢 Jurados presentes en la mesa (ingresa un número de 0 a 3):',
  kit: '📦 Kit electoral:\n1️⃣ Recibido\n2️⃣ No Recibido\n\nResponde con el número (1 o 2):',
  sillas: '🪑 Sillas de la mesa:\n1️⃣ Completas\n2️⃣ No Completas\n\nResponde con el número (1 o 2):',
  mesa: '🗳️ Estado de la mesa física:\n1️⃣ Está\n2️⃣ No Está\n\nResponde con el número (1 o 2):',
  obs: '📝 Observaciones (escribe tu comentario o escribe "-" si no aplica):',
  plancha1: '🟦 Votos Plancha 1 (ingresa la cantidad):', plancha2: '🟦 Votos Plancha 2 (ingresa la cantidad):', plancha3: '🟦 Votos Plancha 3 (ingresa la cantidad):',
  plancha4: '🟦 Votos Plancha 4 (ingresa la cantidad):', plancha5: '🟦 Votos Plancha 5 (ingresa la cantidad):',
  blanco: '⚪ Votos en blanco (ingresa la cantidad):', nulos: '🚫 Votos nulos (ingresa la cantidad):', noMarcados: '⬜ Votos no marcados (ingresa la cantidad):',
  total: '🔢 Total de votos sufragantes de la mesa:',
  incinerados: '🔥 Votos incinerados (0 si ninguno):',
};

function norm(v) { return String(v || '').toUpperCase().trim(); }
function menu() {
  return `Hola. Soy el bot de reporte electoral. Por favor elige el momento a diligenciar:
1️⃣ Instalación
2️⃣ Participación (parciales)
3️⃣ Acta 021 (preconteo)

Responde enviando el número de la opción (1, 2 o 3).
(Escribe AYUDA o CANCELAR en cualquier momento.)`;
}
function ayuda() {
  return `Comandos disponibles:
• 1 / 2 / 3 -> Elegir momento a reportar
• CANCELAR  -> Reiniciar la conversación
• CORREGIR  -> Volver a ingresar los datos de la mesa
• AYUDA     -> Ver este mensaje de ayuda`;
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

function menu(coord, seccional) {
  const nombre = (coord && (coord.nombre || (coord.mesas && coord.mesas[0] && coord.mesas[0].nombre))) || 'Coordinador';
  const esSec = coord && coord.tipo === 'seccional';
  const tipoStr = esSec ? 'Seccional' : 'de Mesa';

  let textoMesas = '';
  if (esSec) {
    textoMesas = `📌 *Tienes asignadas todas las mesas de la seccional ${seccional}.*`;
  } else if (coord && coord.mesas && coord.mesas.length) {
    const lista = coord.mesas.map(m => `• *Mesa ${m.codigo}* — ${m.municipio || ''}`).join('\n');
    textoMesas = `📌 *Tus mesas asignadas:*
${lista}`;
  }

  return `👋 ¡Hola, ${nombre}!
Estás registrado como Coordinador ${tipoStr} en la seccional *${seccional}*.

${textoMesas}

Por favor elige el momento a diligenciar:
1️⃣ Instalación
2️⃣ Participación (parciales)
3️⃣ Acta 021 (preconteo)

Responde enviando el número de la opción (1, 2 o 3).
(Escribe AYUDA o CANCELAR en cualquier momento.)`;
}

function confirmacionMesaPrompt(me, coord) {
  const nombre = (coord && (coord.nombre || (coord.mesas && coord.mesas[0] && coord.mesas[0].nombre))) || 'Coordinador';
  return `📋 *Confirmación de datos de la mesa:*
• *Coordinador:* ${nombre}
• *Seccional:* ${me.seccional}
• *Municipio:* ${me.municipio}
• *Mesa:* ${me.codigo} ${me.numero_local ? '(Mesa N° ' + me.numero_local + ')' : ''}
• *Ubicación / Puesto:* ${me.ubicacion || 'Puesto Principal'}

¿Confirmas que los datos de la mesa son correctos?
1️⃣ SÍ, continuar con el reporte
2️⃣ NO, corregir número de mesa

Responde enviando 1 o 2:`;
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
    return `Vamos a reingresar los datos. ${PREGUNTA[s.campo]}`;
  }

  let session = ctx.getSession(phone);

  if (!session) {
    const seccional = ctx.getSeccionalDeInstancia(instance);
    if (!seccional) return '⛔ Esta línea no está activa para reporte. Contacta al administrador.';
    if (ctx.isCerrado()) return '🔒 La jornada está cerrada. Las correcciones deben hacerse directamente en el documento de Drive.';

    // 1. Comprobar si ya está autorizado directamente (por teléfono directo o LID previamente vinculado)
    const coord = ctx.maestro.isTelefonoAutorizado(phone, seccional);
    if (coord && coord.error === 'seccional_mismatch') {
      return `⛔ Este número está registrado para reportar en la seccional *${coord.seccionales.join(', ')}*, pero estás escribiendo a la línea de la seccional *${seccional}*.\nPor favor escribe a la línea de WhatsApp que corresponda a tu seccional.`;
    }
    if (coord && coord.tipo) {
      session = { paso: 'menu', momento: null, seccional, instance, mesa: null, municipio: null, borrador: {}, campo: null, correccion: false, coordinador: coord };
      ctx.saveSession(phone, session);
      return menu(coord, seccional);
    }

    // 2. Si no está reconocido directamente (ej. iPhone con LID de privacidad o número nuevo)
    session = { paso: 'vincular_telefono', seccional, instance };
    ctx.saveSession(phone, session);
    return `👋 ¡Hola! Bienvenido al sistema de reporte electoral de la seccional *${seccional}*.

📱 Para identificarte, por favor escribe tu **número de celular registrado como coordinador** (ej: 3109876543):`;
  }

  // --- VINCULACIÓN AUTOMÁTICA DE TELÉFONO / LID ---
  if (session.paso === 'vincular_telefono') {
    const rawDigits = text.replace(/\D/g, '');
    if (rawDigits.length < 7) {
      return '⚠️ Por favor ingresa un número de celular válido de 10 dígitos (ej: 3109876543):';
    }
    const telNorm = ctx.maestro.normalizaTel(rawDigits);
    const coordEncontrado = ctx.maestro.buscarCoordinador(telNorm);

    if (!coordEncontrado) {
      return `⚠️ El número celular *${text}* no aparece registrado en la lista oficial de coordinadores.
Por favor verifica tu número o solicita tu asignación al administrador.

📱 Escribe tu número de celular registrado:`;
    }

    const secLinea = session.seccional;
    const esDeEstaSeccional = coordEncontrado.tipo === 'seccional'
      ? ctx.maestro.norm(coordEncontrado.seccional) === ctx.maestro.norm(secLinea)
      : coordEncontrado.mesas.some(m => ctx.maestro.norm(m.seccional) === ctx.maestro.norm(secLinea));

    if (!esDeEstaSeccional) {
      const secCoord = coordEncontrado.seccional || (coordEncontrado.mesas[0] && coordEncontrado.mesas[0].seccional);
      ctx.clearSession(phone);
      return `⛔ El número *${text}* está registrado para reportar en la seccional *${secCoord}*, pero estás escribiendo a la línea de la seccional *${secLinea}*.\n\nPor favor escribe a la línea de WhatsApp correspondiente a tu seccional (*${secCoord}*).`;
    }

    // Guardar vinculación permanente del LID/remitente al teléfono en SQLite y memoria
    if (ctx.state && ctx.state.setLidMapping) {
      ctx.state.setLidMapping(phone, telNorm);
    }
    ctx.maestro.setLidMapping(phone, telNorm);

    const coordAutorizado = ctx.maestro.isTelefonoAutorizado(phone, secLinea);
    session = { paso: 'menu', momento: null, seccional: secLinea, instance, mesa: null, municipio: null, borrador: {}, campo: null, correccion: false, coordinador: coordAutorizado };
    ctx.saveSession(phone, session);
    return `✅ ¡Identificación exitosa!\n\n` + menu(coordAutorizado, secLinea);
  }

  // --- MENÚ ---
  if (session.paso === 'menu') {
    const momento = MOMENTOS[text];
    if (!momento) {
      return '⚠️ La opción ingresada no corresponde con la lista.\nPor favor responde seleccionando un número de la lista (1, 2 o 3):\n\n' + menu(session.coordinador, session.seccional);
    }
    session.momento = momento;

    // Si el coordinador tiene exactamente 1 mesa asignada, auto-seleccionarla
    const coord = session.coordinador;
    if (coord && coord.tipo === 'mesa' && Array.isArray(coord.mesas) && coord.mesas.length === 1) {
      const mesaAsignada = coord.mesas[0];
      const mesaObj = ctx.maestro.getMesaExacta(mesaAsignada.codigo, {
        seccional: session.seccional,
        municipio: mesaAsignada.municipio
      }) || mesaAsignada;

      session.mesa = mesaAsignada.codigo;
      session.municipio = mesaObj.municipio;
      session.mesaObj = mesaObj;
      session.paso = 'validar_mesa_info';
      ctx.saveSession(phone, session);
      return confirmacionMesaPrompt(mesaObj, coord);
    }

    session.paso = 'mesa';
    ctx.saveSession(phone, session);
    return `🆔 Código de mesa (ingresa el número de mesa, ej: 134):`;
  }

  // --- MESA ---
  if (session.paso === 'mesa') {
    const codigo = Number(text);
    if (!Number.isInteger(codigo) || codigo <= 0) return '⚠️ Código de mesa inválido. Por favor envía un número válido (ej: 134).';
    const candidatas = ctx.maestro.getMesasPorCodigo(codigo);
    if (candidatas.length === 0) return `⚠️ No existe la mesa ${codigo} en el catálogo. Por favor verifica el número.`;
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
      return `⛔ La mesa ${codigo} no pertenece a tu seccional (${session.seccional}).`;
    }
    if (poolFinal.length > 1) {
      session.mesa = codigo;
      session.candidatas = poolFinal.map(me => me.municipio);
      session.paso = 'mesa_mun';
      ctx.saveSession(phone, session);
      let listMun = poolFinal.map((me, idx) => `${idx + 1}️⃣ ${me.municipio}`).join('\n');
      return `La mesa ${codigo} está presente en varios municipios. Elige el municipio por el que vota:\n\n${listMun}\n\nResponde con el número correspondiente.`;
    }
    session.mesa = codigo;
    session.municipio = poolFinal[0].municipio;
    session.mesaObj = poolFinal[0];
    session.paso = 'validar_mesa_info';
    ctx.saveSession(phone, session);
    return confirmacionMesaPrompt(poolFinal[0], session.coordinador);
  }
  if (session.paso === 'mesa_mun') {
    const idxNum = parseInt(text, 10);
    let found = null;
    if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= session.candidatas.length) {
      found = session.candidatas[idxNum - 1];
    } else {
      const munUpper = text.toUpperCase();
      found = session.candidatas.find(m => String(m).toUpperCase() === munUpper) ||
        session.candidatas.find(m => String(m).toUpperCase().includes(munUpper));
    }
    if (!found) {
      let listMun = session.candidatas.map((me, idx) => `${idx + 1}️⃣ ${me}`).join('\n');
      return `⚠️ La opción ingresada no corresponde con la lista.\nElige un municipio de la lista:\n\n${listMun}`;
    }
    const me = ctx.maestro.getMesaExacta(session.mesa, { seccional: session.seccional, municipio: found });
    if (session.coordinador.tipo === 'mesa') {
      const ok = session.coordinador.mesas.some(m =>
        m.codigo === session.mesa && norm(m.municipio) === norm(me.municipio) && norm(m.seccional) === norm(me.seccional));
      if (!ok) return `⛔ No estás asignado a la mesa ${session.mesa} (${found}).`;
    }
    session.municipio = me.municipio;
    session.mesaObj = me;
    session.paso = 'validar_mesa_info';
    ctx.saveSession(phone, session);
    return confirmacionMesaPrompt(me, session.coordinador);
  }

  // --- CONFIRMACIÓN DE DATOS DE LA MESA Y UBICACIÓN ---
  if (session.paso === 'validar_mesa_info') {
    if (text === '1' || lower === 'si' || lower === 'sí' || lower === 's') {
      session.paso = siguienteTrasMesa(session, ctx);
      ctx.saveSession(phone, session);
      return session.paso === 'part_rep' ? '🔢 Número de boletín (1, 2 o 3):' : PREGUNTA[session.campo];
    }
    if (text === '2' || lower === 'no' || lower === 'n') {
      session.paso = 'mesa';
      session.mesa = null;
      session.municipio = null;
      ctx.saveSession(phone, session);
      return 'Entendido. Por favor ingresa el número de mesa correcto (ej: 134):';
    }
    return '⚠️ La opción ingresada no corresponde con la lista.\n' + confirmacionMesaPrompt(session.mesaObj, session.coordinador);
  }

  // --- PARTICIPACIÓN (dinámica por boletines) ---
  if (session.paso === 'part_rep') {
    const r = V.validarNumeroReporte(text);
    if (!r.ok) return '⚠️ Opción inválida. Responde 1, 2 o 3 para el número de boletín.';
    const num = r.value;
    const anteriores = session.borrador;
    const seq = V.validarSecuenciaParticipacion(anteriores, num);
    if (!seq.ok) return seq.msg;
    session._rep = num;
    session.paso = 'part_suf';
    ctx.saveSession(phone, session);
    return `👥 Sufragantes del boletín ${num} (ingresa la cantidad de votos):`;
  }
  if (session.paso === 'part_suf') {
    const s = V.validarSufragantes(text);
    if (!s.ok) return '⚠️ Cantidad inválida. Ingresa un número entero.';
    const num = session._rep;
    const dec = V.validarNoDecrecimiento(session.borrador, num, s.value);
    if (!dec.ok) return dec.msg;
    session._suf = s.value;
    session.paso = 'part_obs';
    ctx.saveSession(phone, session);
    return '📝 Observaciones de este boletín (escribe tu comentario o "-" si no aplica):';
  }
  if (session.paso === 'part_obs') {
    const o = text === '-' ? '' : text;
    const r = V.validarObs(o);
    if (!r.ok) return r.msg;
    session.borrador[session._rep] = { sufragantes: session._suf, observaciones: r.value };
    session.paso = 'part_mas';
    ctx.saveSession(phone, session);
    return '¿Deseas reportar otro boletín?\n1️⃣ SÍ\n2️⃣ NO\n\nResponde 1 o 2:';
  }
  if (session.paso === 'part_mas') {
    if (text === '1' || lower === 'si' || lower === 'sí' || lower === 's') {
      session.paso = 'part_rep'; ctx.saveSession(phone, session);
      return '🔢 Número de boletín (1, 2 o 3):';
    }
    if (text === '2' || lower === 'no' || lower === 'n') {
      session.paso = 'confirm'; ctx.saveSession(phone, session);
      return resumen(session);
    }
    return '⚠️ La opción ingresada no corresponde con la lista.\n¿Deseas reportar otro boletín?\n1️⃣ SÍ\n2️⃣ NO\n\nResponde enviando 1 o 2.';
  }

  // --- INSTALACIÓN y ACTA 021 (campo a campo) ---
  if (session.paso && (session.paso.startsWith('instalacion_') || session.paso.startsWith('acta021_'))) {
    const campo = session.campo;
    const vr = validarCampo(campo, text);
    if (!vr.ok) return vr.msg + '\n\n' + PREGUNTA[campo];
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
    return resumen(session) + '\n\n¿Confirmas el envío?\n1️⃣ SÍ\n2️⃣ NO\n\nResponde 1 o 2:';
  }

  // --- CONFIRMAR ---
  if (session.paso === 'confirm') {
    if (text === '1' || lower === 'si' || lower === 'sí' || lower === 's') {
      const resp = await escribir(session, ctx);
      if (!resp.ok) return '⚠️ No se pudo guardar: ' + resp.msg + '. Corrige respondiendo con CORREGIR o cancela con CANCELAR.';
      ctx.clearSession(phone);
      return `✅ ${NOMBRE_MOMENTO[session.momento]} de la mesa ${session.mesa} (${session.seccional}) registrada exitosamente.` + (resp.alerta ? `\n${resp.alerta}` : '');
    }
    if (text === '2' || lower === 'no' || lower === 'n') {
      // reingresar desde el inicio del momento
      session.borrador = {}; session.campo = ORDEN[session.momento][0];
      session.paso = session.momento + '_' + session.campo;
      ctx.saveSession(phone, session);
      return 'Vamos a reingresar los datos. ' + PREGUNTA[session.campo];
    }
    return '⚠️ La opción ingresada no corresponde con la lista.\n¿Confirmas el envío?\n1️⃣ SÍ\n2️⃣ NO\n\nResponde enviando 1 o 2.';
  }

  return ayuda();
}

module.exports = { handle, menu, ayuda, _ORDEN: ORDEN };
