'use strict';
const readline = require('readline');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3] || '';
const SHEET_ID = process.argv[4] || '';
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';

if (!CLIENT_ID) {
  console.log('Uso: node scripts/test-oauth-access.js <CLIENT_ID> [CLIENT_SECRET] [SHEET_ID]');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
}).toString();

console.log('\n1) Abre esta URL EN EL NAVEGADOR LOGUEADO CON TU CUENTA WORKSPACE:');
console.log('\n' + authUrl + '\n');
console.log('2) Si ves "Acceso bloqueado / Tu administrador no ha concedido acceso a esta app" => ESTAS BLOQUEADO (usa opcion D).');
console.log('   Si ves la pantalla normal de consentimiento => no estas bloqueado (opcion C viable).\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('3) Pega el codigo que te dio Google: ', async (code) => {
  rl.close();
  try {
    const body = new URLSearchParams({
      code: code.trim(),
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    });
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j = await r.json();
    if (j.error) {
      console.log('\nTOKEN ERROR:', j.error, j.error_description || '');
      if (/admin_policy_enforced|device_policy_violation|blocked/i.test(j.error + ' ' + (j.error_description || ''))) {
        console.log('=> BLOQUEADO por politica del administrador. Descarta la opcion C.');
      } else {
        console.log('=> No es bloqueo de admin; revisa el client_id/secret o reintenta.');
      }
      process.exit(0);
    }
    console.log('\n=> TOKEN OK. Access token obtenido. No estas bloqueado.');
    const headers = { Authorization: 'Bearer ' + j.access_token };
    const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers }).then(r => r.json());
    console.log('   Usuario autenticado:', ui.email);
    if (SHEET_ID) {
      const sh = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '?ranges=A1', { headers }).then(r => r.json());
      if (sh.error) {
        console.log('   Lectura de Sheets:', sh.error.message);
      } else {
        console.log('   Sheets API OK. Hoja accesible:', sh.properties && sh.properties.title);
      }
    } else {
      console.log('   (Sin SHEET_ID: omite la lectura de la hoja; el acceso OAuth ya esta confirmado.)');
    }
  } catch (e) {
    console.log('Fallo inesperado:', e.message);
  }
});
