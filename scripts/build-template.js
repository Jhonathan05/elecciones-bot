'use strict';
/*
 * build-template.js
 * Reconstruye la plantilla de contingencia en:
 *   E:\jhonathan\Open\whatsapp-bot\3_PRECONTEO 2022-PLANCHAS.xlsx
 * - PRECONTEO ampliado a 5 planchas + CONTROL/DESCUADRE/ALERTA
 * - INSTALACION (catálogo + INSTALADA/ALERTA + trazabilidad)
 * - PARTICIPACION (B1/B2/B3 + TOTAL + ALERTA + trazabilidad)
 * - CONSOLIDADO (SUMIFS/COUNTIFS por SECCIONAL)
 * - HISTORIAL (auditoría)
 * Cada fórmula lleva su valor inicial cacheado para que Excel no marque error;
 * Excel/Sheets recalculan al abrir/cambiar inputs.
 */
const X = require('E:\\jhonathan\\Open\\elecciones-fnc\\node_modules\\xlsx');

const SRC_IN = 'E:\\jhonathan\\Open\\elecciones-fnc\\docs\\contexto\\3_PRECONTEO 2022-PLANCHAS.xlsx';
const SRC_OUT = 'E:\\jhonathan\\Open\\whatsapp-bot\\3_PRECONTEO 2022-PLANCHAS.xlsx';

// Fórmula con valor inicial cacheado (tipo según el valor)
function F(f, v) {
  return { t: (typeof v === 'number' ? 'n' : 's'), f, v };
}

function setCell(ws, r, c, v) {
  if (v === undefined || v === null || v === '') {
    // permitir cero, pero omitir cadenas vacías
    if (v !== 0) return;
  }
  const a = X.utils.encode_cell({ r, c });
  if (v && typeof v === 'object' && v.f !== undefined) {
    ws[a] = { t: v.t, f: v.f, v: v.v };
  } else if (typeof v === 'number') {
    ws[a] = { t: 'n', v };
  } else {
    ws[a] = { t: 's', v: String(v) };
  }
}

function buildSheet(headers, rows) {
  const ws = {};
  const nRows = rows.length + 1;
  const nCols = headers.length;
  headers.forEach((h, c) => setCell(ws, 0, c, h));
  rows.forEach((row, i) => row.forEach((v, c) => setCell(ws, i + 1, c, v)));
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: nRows - 1, c: nCols - 1 } });
  ws['!cols'] = headers.map((h, c) => ({ wch: Math.min(22, Math.max(10, String(h).length + 2)) }));
  return ws;
}

function readSource() {
  const wb = X.readFile(SRC_IN);
  const ws = wb.Sheets['PRECONTEO'];
  const range = X.utils.decode_range(ws['!ref']);
  const lastRow = range.e.r + 1;
  const data = [];
  for (let r = 1; r < lastRow; r++) {
    const row = [];
    for (let c = 0; c <= 18; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v : undefined);
    }
    data.push(row);
  }
  return data;
}

function buildPreconteo(src) {
  const headers = [
    'UBICACION', 'DEPARTAMENTO', 'SECCIONAL UBICACION MESA', 'MUNICIPIO UBICACION MESA', 'TIPO_MESA',
    'NUMERO_MESA', 'ESTIMADO VOTOS 2022', 'CIRCUNSCRIPCIÓN POR LA QUE VOTA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA',
    'MESAS REPORTADAS', 'Total Sufragantes Planchas', 'Votos Incinerados Planchas',
    'Plancha 1', 'Plancha 2', 'Plancha 3', 'Plancha 4', 'Plancha 5',
    'Votos en Blanco Planchas', 'Votos Nulos Planchas', 'Votos no Marcados Planchas',
    'Total Votos Mesa por Plancha', 'CONTROL', 'DESCUADRE', 'ALERTA', 'NOMBRE COORD MESA', 'CONTACTO COORD MESA'
  ];
  const rows = src.map((s, i) => {
    const r = i + 2;
    const n = s[13] || 0, o = s[14] || 0, p = s[15] || 0, q = 0, rr = 0;
    const bl = s[16] || 0, nu = s[17] || 0, nm = s[18] || 0;
    const sum = n + o + p + q + rr + bl + nu + nm;
    const totalSuf = s[11] || 0;
    const reportada = (s[10] !== undefined && s[10] !== '' && s[10] !== 0);
    const control = (totalSuf === sum) ? 'SI' : 'NO';
    const desc = totalSuf - sum;
    const alerta = !reportada ? 'PENDIENTE' : (totalSuf === sum ? 'OK' : 'ALERTA CUADRE');
    return [
      s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9],
      s[10], s[11], s[12],
      n, o, p, q, rr,
      bl, nu, nm,
      F(`SUM(N${r}:U${r})`, sum),
      F(`IF(L${r}=V${r},"SI","NO")`, control),
      F(`L${r}-V${r}`, desc),
      F(`IF(K${r}="","PENDIENTE",IF(L${r}=V${r},"OK","ALERTA CUADRE"))`, alerta),
      undefined, undefined
    ];
  });
  return buildSheet(headers, rows);
}

function buildInstalacion(src) {
  const headers = [
    'UBICACION', 'DEPARTAMENTO', 'SECCIONAL UBICACION MESA', 'MUNICIPIO UBICACION MESA', 'TIPO_MESA',
    'NUMERO_MESA', 'ESTIMADO VOTOS 2022', 'CIRCUNSCRIPCIÓN POR LA QUE VOTA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA',
    'JURADOS', 'KIT ELECTORAL', 'SILLAS', 'MESA FÍSICA', 'OBSERVACIONES',
    'INSTALADA', 'ALERTA', 'REPORTADO_POR', 'FECHA_REPORTE', 'VERSION', 'ESTADO'
  ];
  const rows = src.map((s, i) => {
    const r = i + 2;
    return [
      s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9],
      undefined, undefined, undefined, undefined, undefined,
      F(`IF(AND(K${r}=3,L${r}="Recibido",M${r}="Completas",N${r}="Está"),"SI","NO")`, 'NO'),
      F(`IF(K${r}="","PENDIENTE",IF(P${r}="SI","OK","ALERTA"))`, 'PENDIENTE'),
      undefined, undefined, undefined, 'PENDIENTE'
    ];
  });
  return buildSheet(headers, rows);
}

function buildParticipacion(src) {
  const headers = [
    'UBICACION', 'DEPARTAMENTO', 'SECCIONAL UBICACION MESA', 'MUNICIPIO UBICACION MESA', 'TIPO_MESA',
    'NUMERO_MESA', 'ESTIMADO VOTOS 2022', 'CIRCUNSCRIPCIÓN POR LA QUE VOTA', 'MUNICIPIO POR EL QUE VOTA', 'CÓDIGO MESA',
    'SUFRAGANTES B1', 'OBS B1', 'SUFRAGANTES B2', 'OBS B2', 'SUFRAGANTES B3', 'OBS B3',
    'TOTAL SUFRAGANTES', 'ALERTA', 'REPORTADO_POR', 'FECHA_REPORTE', 'VERSION', 'ESTADO'
  ];
  const rows = src.map((s, i) => {
    const r = i + 2;
    return [
      s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9],
      undefined, undefined, undefined, undefined, undefined, undefined,
      F(`IF(O${r}<>"",O${r},IF(M${r}<>"",M${r},K${r}))`, ''),
      F(`IF(AND(K${r}<>"",M${r}<>"",M${r}<K${r}),"ALERTA DESCENSO",` +
        `IF(AND(M${r}<>"",O${r}<>"",O${r}<M${r}),"ALERTA DESCENSO",` +
        `IF(AND(M${r}<>"",K${r}=""),"PENDIENTE B1",` +
        `IF(AND(O${r}<>"",M${r}=""),"PENDIENTE B2",` +
        `IF(AND(O${r}="",M${r}="",K${r}=""),"PENDIENTE","OK")))))`, 'PENDIENTE'),
      undefined, undefined, undefined, 'PENDIENTE'
    ];
  });
  return buildSheet(headers, rows);
}

function uniqueSeccionales(src) {
  const set = [];
  src.forEach(s => { const v = s[2]; if (v && !set.includes(v)) set.push(v); });
  return set;
}

function buildConsolidado(src) {
  const secc = uniqueSeccionales(src);
  const headers = [
    'SECCIONAL', 'MESAS TOTAL', 'INSTALADAS', 'ALERTA INSTALACION', 'SUFRAGANTES',
    'VOTOS 021', 'MESAS REPORTADAS 021', 'CUADRE OK', 'DESCUADRE'
  ];
  const rows = secc.map((s, i) => {
    const r = i + 2;
    return [
      s,
      F(`COUNTIFS(PRECONTEO!C:C,A${r})`, 0),
      F(`COUNTIFS(INSTALACION!C:C,A${r},INSTALACION!P:P,"SI")`, 0),
      F(`COUNTIFS(INSTALACION!C:C,A${r},INSTALACION!Q:Q,"ALERTA")`, 0),
      F(`SUMIFS(PARTICIPACION!Q:Q,PARTICIPACION!C:C,A${r})`, 0),
      F(`SUMIFS(PRECONTEO!L:L,PRECONTEO!C:C,A${r})`, 0),
      F(`COUNTIFS(PRECONTEO!C:C,A${r},PRECONTEO!K:K,1)`, 0),
      F(`COUNTIFS(PRECONTEO!C:C,A${r},PRECONTEO!W:W,"SI")`, 0),
      F(`COUNTIFS(PRECONTEO!C:C,A${r},PRECONTEO!W:W,"NO")`, 0)
    ];
  });
  const last = rows.length + 1;
  rows.push([
    'TOTAL',
    F(`SUM(B2:B${last})`, 0), F(`SUM(C2:C${last})`, 0), F(`SUM(D2:D${last})`, 0),
    F(`SUM(E2:E${last})`, 0), F(`SUM(F2:F${last})`, 0), F(`SUM(G2:G${last})`, 0),
    F(`SUM(H2:H${last})`, 0), F(`SUM(I2:I${last})`, 0)
  ]);
  return buildSheet(headers, rows);
}

function buildHistorial() {
  const headers = ['timestamp', 'línea', 'teléfono', 'mesa', 'momento', 'campo', 'valor_anterior', 'valor_nuevo', 'motivo'];
  return buildSheet(headers, []);
}

function buildSeccionales(src) {
  const headers = [
    'SECCIONAL', 'CIRCUNSCRIPCIÓN POR LA QUE VOTA', 'MUNICIPIO',
    'NOMBRE COORD SECCIONAL', 'CONTACTO COORD SECCIONAL', 'NUMERO LINEA'
  ];
  const map = {};
  src.forEach(s => {
    const sec = s[2];
    if (!sec) return;
    if (!map[sec]) map[sec] = { circ: s[7] || '', mun: s[8] || s[3] || '' };
  });
  const rows = Object.keys(map).map(sec => [sec, map[sec].circ, map[sec].mun, undefined, undefined, undefined]);
  return buildSheet(headers, rows);
}

function main() {
  const src = readSource();
  const wb = buildWorkbook(src);
  X.writeFile(wb, SRC_OUT);
  console.log('Plantilla regenerada:', SRC_OUT);
  console.log('Filas de datos:', src.length, '| Seccionales:', uniqueSeccionales(src).length);
}

function buildWorkbook(src) {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, buildPreconteo(src), 'PRECONTEO');
  X.utils.book_append_sheet(wb, buildInstalacion(src), 'INSTALACION');
  X.utils.book_append_sheet(wb, buildParticipacion(src), 'PARTICIPACION');
  X.utils.book_append_sheet(wb, buildConsolidado(src), 'CONSOLIDADO');
  X.utils.book_append_sheet(wb, buildSeccionales(src), 'SECCIONALES');
  X.utils.book_append_sheet(wb, buildHistorial(), 'HISTORIAL');
  return wb;
}

module.exports = { buildWorkbook, readSource, uniqueSeccionales };

if (require.main === module) main();
