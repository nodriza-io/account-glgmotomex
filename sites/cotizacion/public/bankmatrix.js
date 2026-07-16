/* eslint-env browser */
/* global BANKS */
/**
 * Matriz de bancos editable desde un Google Sheet publicado como CSV.
 * El cliente edita la planilla; al abrir el cotizador el site la lee y actualiza
 * las tasas/seguros/enganche/plazos SIN redeploy. Si no hay URL o falla la lectura,
 * se usa la matriz embebida en data.js (fallback seguro).
 *
 * Layout del CSV — columnas con nombres claros, UNA fila por regla de tasa:
 *   Banco | Cilindrada | Enganche desde (%) | Tasa anual (%) | Seguro ($) |
 *   Seguro de vida ($) | Plazos (meses) | Comisión apertura (%)
 *   - Un banco+cilindrada puede tener varias filas (una por tramo de enganche).
 *   - Se aplica la MEJOR (menor) tasa cuyo "Enganche desde" cumpla el cliente.
 *   - Tasas y comisión en %, ej. 17.99 y 3. El enganche mínimo se toma del tramo más bajo.
 */

// Google Sheet (endpoint gviz CSV — pasa CORS y refleja el Origin del site).
const SHEET_ID = '1qfk8_Y2lEpJ7JkCTJCfo--snNDwCNHIS_tNE6k3DDTE';
const BANK_MATRIX_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`; // primera pestaña (tasas)
const MODELOS_SHEET_NAMES = ['Modelos', 'modelos-template', 'modelos', 'Modelos GLG']; // nombres de pestaña a probar

function bankKeyFromName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n.indexOf('santander') > -1) return 'santander';
  if (n.indexOf('bbva') > -1) return 'bbva';
  if (n.indexOf('banregio') > -1) return 'banregio';
  return null;
}
// Convierte a número tolerando el locale: coma o punto como decimal, y separador de miles.
function csvNum(v) {
  let s = String(v == null ? '' : v).trim().replace(/[^\d.,\-]/g, '');
  if (!s) return 0;
  const hasC = s.indexOf(',') > -1, hasD = s.indexOf('.') > -1;
  if (hasC && hasD) {
    // el decimal es el separador que aparece más a la derecha
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(/,/g, '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) {
    s = s.replace(/,/g, '.'); // coma = decimal (ej. 17,99)
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Parser CSV robusto (soporta comillas y comas dentro de campos, ej. la lista de plazos).
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseBankCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return null;
  const banks = {};
  for (let i = 1; i < lines.length; i++) { // saltar encabezado
    const c = parseCsvLine(lines[i]);
    const key = bankKeyFromName(c[0]);
    const cil = parseInt(c[1], 10);
    if (!key || !cil) continue;
    if (!banks[key]) banks[key] = { name: (c[0] || '').trim(), enabled: true, cxa: 0, cilindradas: {} };
    if (String(c[7] == null ? '' : c[7]).trim() !== '') banks[key].cxa = csvNum(c[7]) / 100; // comisión en %
    let cc = banks[key].cilindradas[cil];
    if (!cc) {
      const plazos = String(c[6] || '').split(/[,\s]+/).map(x => parseInt(x, 10)).filter(Boolean);
      cc = banks[key].cilindradas[cil] = {
        plazos: plazos.length ? plazos : [12, 24, 36, 48, 60],
        minEng: Infinity, maxEng: 60,
        seguro: csvNum(c[4]), seguroVida: csvNum(c[5]),
        tiers: [],
      };
    }
    const desde = csvNum(c[2]);
    cc.tiers.push({ minEng: desde, rate: csvNum(c[3]) / 100 }); // Tasa anual (%)
    if (desde < cc.minEng) cc.minEng = desde; // el enganche mínimo = el tramo más bajo
  }
  Object.keys(banks).forEach(k => Object.keys(banks[k].cilindradas).forEach(cil => {
    const cc = banks[k].cilindradas[cil];
    if (!isFinite(cc.minEng)) cc.minEng = 20;
    if (!cc.tiers.length) cc.tiers = [{ minEng: cc.minEng, rate: 0.1799 }];
    cc.tiers.sort((a, b) => b.minEng - a.minEng);
  }));
  return Object.keys(banks).length ? banks : null;
}

// Aplica la matriz leída sobre BANKS (merge por cilindrada; deja intactas las que no vengan).
function applyMatrix(parsed) {
  if (!parsed) return;
  Object.keys(parsed).forEach(k => {
    if (!BANKS[k]) return; // solo bancos conocidos
    if (parsed[k].cxa) BANKS[k].cxa = parsed[k].cxa;
    const cils = parsed[k].cilindradas || {};
    Object.keys(cils).forEach(cil => { BANKS[k].cilindradas[cil] = cils[cil]; });
  });
}

async function loadBankMatrix() {
  if (!BANK_MATRIX_CSV_URL) return; // sin URL configurada → usa el data.js embebido
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(BANK_MATRIX_CSV_URL, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    applyMatrix(parseBankCsv(await r.text()));
    console.log('[GLG] Matriz de bancos actualizada desde Google Sheet.');
  } catch (e) {
    console.warn('[GLG] No se pudo leer el Sheet, uso la matriz embebida:', e.message);
  }
}

/* ============================================================================
   Clasificación de modelos desde la pestaña "Modelos" del Sheet.
   Layout: columna 1 = SKU (o palabra clave) | columna 2 = Cilindrada (350/450/650).
   Se matchea por substring (un SKU completo también matchea). Se ordenan por
   longitud descendente para que gane la coincidencia más específica.
   Fallback: clasificación embebida en data.js (findModeloBySku).
   ============================================================================ */
let MODELOS_KEYWORDS = []; // [{ k: 'pl 2025 classic halcyon green', cil: 350 }, ...] ordenado por k.length desc
function normModelo(s) { return String(s == null ? '' : s).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function esCilindrada(v) { const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10); return (n === 350 || n === 450 || n === 650) ? n : null; }

function parseModelosCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return [];
  // Si la pestaña "Modelos" no existe, gviz devuelve la primera pestaña (tasas). Rechazarla.
  if (/banco|tasa|enganche|comisi|seguro|plazo/i.test(lines[0])) return [];
  const BANCOS = { santander: 1, bbva: 1, banregio: 1 };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    let c = parseCsvLine(lines[i]);
    c = c.reduce((a, cell) => a.concat(String(cell).split(',')), []); // aplana "sku,350" pegado en una sola columna
    // La cilindrada es la celda que vale 350/450/650; el SKU/clave es la primera celda de texto restante.
    let cil = null, key = '';
    for (let j = 0; j < c.length; j++) { const cc = esCilindrada(c[j]); if (cc && cil === null) cil = cc; }
    for (let j = 0; j < c.length; j++) { const t = normModelo(c[j]); if (t && !esCilindrada(c[j])) { key = t; break; } }
    if (key && cil && !BANCOS[key]) out.push({ k: key, cil }); // ignora claves que sean nombre de banco
  }
  out.sort((a, b) => b.k.length - a.k.length); // la coincidencia más específica primero
  return out;
}

async function loadModelosMatrix() {
  // Prueba varios nombres de pestaña. gviz devuelve la 1ª pestaña si el nombre no existe,
  // pero parseModelosCsv la rechaza (guard de encabezado), así que solo entra una pestaña de modelos real.
  for (let i = 0; i < MODELOS_SHEET_NAMES.length; i++) {
    try {
      const url = `${BANK_MATRIX_CSV_URL}&sheet=${encodeURIComponent(MODELOS_SHEET_NAMES[i])}`;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) continue;
      const parsed = parseModelosCsv(await r.text());
      if (parsed.length) { MODELOS_KEYWORDS = parsed; console.log(`[GLG] Modelos desde pestaña "${MODELOS_SHEET_NAMES[i]}": ${parsed.length} reglas.`); return; }
    } catch (e) { /* probar siguiente candidato */ }
  }
  console.log('[GLG] Sin pestaña de modelos válida; uso la clasificación embebida (data.js).');
}

// Devuelve la cilindrada (350/450/650) de un producto, priorizando la pestaña "Modelos"
// del Sheet; si no matchea, cae a la clasificación embebida en data.js (findModeloBySku).
function cilindradaDeSku(sku, nombre) {
  const hay = normModelo((sku || '') + ' ' + (nombre || ''));
  for (let i = 0; i < MODELOS_KEYWORDS.length; i++) {
    if (hay.indexOf(MODELOS_KEYWORDS[i].k) > -1) return MODELOS_KEYWORDS[i].cil;
  }
  const m = (typeof findModeloBySku === 'function') ? findModeloBySku(sku, nombre) : null;
  return m ? m.cilindrada : null;
}
