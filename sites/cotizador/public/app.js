/* eslint-env browser */
/**
 * Site 2 — Visor de la simulación de crédito (GLG). SOLO LECTURA.
 * Lee el Deal (customFields.fin* + el producto de la propuesta) y muestra la
 * simulación del banco elegido, con la estética del banco. No es modificable.
 */
const $ = id => document.getElementById(id);
const CFG = window.__PROLIBU_CONFIG__ || {};
const IS_LOCAL = /^(localhost|127\.0\.0\.1|)$/.test(window.location.hostname);
const DOMAIN = CFG.domain || (IS_LOCAL ? 'glgmotomex.prolibu.com' : window.location.hostname);

const BANK_THEME = {
  santander: { name: 'Santander', color: '#ec0000', logo: 'Santander', img: 'logo-santander.svg' },
  bbva: { name: 'BBVA', color: '#072146', logo: 'BBVA', img: 'logo-bbva.svg' },
  banregio: { name: 'Banregio', color: '#ff6a00', logo: 'Banregio' }, // sin logo oficial → texto
};
const BANK_KEY_BY_NAME = { Santander: 'santander', BBVA: 'bbva', Banregio: 'banregio' };

const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const money = n => fmtMXN.format(Number(n) || 0);
const pct = v => { const x = Number(v) || 0; return (x <= 1 ? x * 100 : x).toFixed(2).replace(/\.00$/, '') + '%'; };
const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------- Obtener el Deal ----------------
// Intenta primero el patrón conocido de la vista pública (/view/deal/<id>/<contactId>);
// si el host que embebe el site es otra pantalla (p. ej. el Edit interno, con una URL
// distinta), cae a tomar el/los primeros ids de 24 hex que aparezcan en la URL —
// el propio deal (y, si hay un segundo, el contacto).
function parseDealUrl() {
  let url = document.referrer || window.location.href;
  try { if (window.parent !== window && window.parent.location.href) url = window.parent.location.href; } catch (e) { /* cross-origin */ }
  let origin;
  try { origin = new URL(url).origin; } catch (e) { return null; }
  const strict = url.match(/\/(?:ui\/spa\/)?view\/deal\/([a-f0-9]{24})\/([a-f0-9]{24}|none)/i);
  if (strict) return { jsonUrl: `${origin}/view/deal/${strict[1]}/${strict[2]}/?format=json` };
  const ids = url.match(/[a-f0-9]{24}/gi);
  if (!ids || !ids.length) return null;
  const dealId = ids[0];
  const contactId = ids[1] || 'none';
  return { jsonUrl: `${origin}/view/deal/${dealId}/${contactId}/?format=json` };
}
async function fetchDeal(jsonUrl) {
  const r = await fetch(jsonUrl, { headers: { Accept: 'application/json' }, credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ---------------- Extraer la simulación (un solo custom field JSON) ----------------
function extractSim(deal) {
  const raw = deal && deal.customFields && deal.customFields.simulacionCredito;
  if (!raw) return null;
  let sim;
  try { sim = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
  if (!sim) return null;
  if (sim.contado) return sim; // pago de contado: no requiere banco
  if (!sim.banco) return null;
  if (!BANK_THEME[sim.banco]) sim.banco = BANK_KEY_BY_NAME[sim.bancoName] || 'bbva';
  return sim;
}

// Normaliza specialNotes (array de strings u objetos) a un array de textos.
function notesArray(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(x => (typeof x === 'string' ? x : (x && (x.text || x.note || x.value || x.body)) || '')).map(s => String(s).trim()).filter(Boolean);
}

// ---------------- Ajuste al panel anfitrión (visor de propuestas) ----------------
// El site se embebe en un iframe cuyo alto lo fija la plantilla de la propuesta
// (p. ej. 592px) dentro de una "página" que puede ser más alta (612px): eso deja
// una franja del fondo de la página asomando abajo, y el contenido queda
// centrado respecto del iframe y no de la página. Como el visor es del mismo
// origen, estiramos nuestro propio contenedor (que está posicionado en
// absoluto) para cubrir la página completa; en el skin de contado además
// pintamos la página de negro para que no asome blanco por ningún borde.
// Si el embebido es de otro origen, frameElement es null (o tira SecurityError)
// y no hacemos nada: manda el layout del host.
function fitToHostPage(dark) {
  let frame;
  try { frame = window.frameElement; } catch (e) { return; }
  if (!frame) return;

  // Subir por el DOM cruzando los límites de shadow DOM hasta la "página".
  let page = null;
  for (let n = frame; n; n = n.parentElement || (n.parentNode && n.parentNode.host) || null) {
    if (n.classList && n.classList.contains('page')) { page = n; break; }
  }

  // Estirar el contenedor del iframe a todo el alto del bloque que lo aloja.
  const box = frame.parentElement;
  const view = box && box.ownerDocument.defaultView;
  if (view && view.getComputedStyle(box).position === 'absolute') {
    box.style.top = '0px';
    box.style.bottom = '0px';
    box.style.height = 'auto';
  }

  // Sólo si nuestro bloque es el único contenido de la página: si compartiera
  // página con otros bloques, pintarla de negro rompería a los demás.
  if (dark && page && page.children.length === 1) page.style.backgroundColor = '#000';
}

// ---------------- Render: pago de contado (sin banco/tasa/plazo) ----------------
// Sin banco no hay marca de banco que mostrar: se usa la identidad real de
// Royal Enfield (negro + rojo, royalenfieldco.com) en toda la hoja en vez del
// acento neutro — clases .re-* propias, ver el bloque "skin-contado" del CSS.
function renderContado(sim) {
  document.body.className = 'skin-contado';
  fitToHostPage(true);

  $('loading').style.display = 'none';
  $('error').style.display = 'none';
  $('view').style.display = 'block';

  const row = (label, value, sub, extraClass) => `<div class="re-row"><span class="re-row-k">${escHtml(label)}${sub ? `<small>${escHtml(sub)}</small>` : ''}</span><span class="re-row-v${extraClass ? ' ' + extraClass : ''}">${value}</span></div>`;

  const descuento = Number(sim.descuento) || 0;
  const precioLista = Number(sim.precioLista) || sim.precio;
  const conDescuento = descuento > 0;
  const precioNeto = Number(sim.precio) || 0;

  const rows = [];
  if (sim.precio) rows.push(row('Precio del vehículo', money(conDescuento ? precioLista : sim.precio)));
  if (conDescuento) rows.push(row('Descuento', `−${money(descuento)}`, null, 'is-credit'));

  const ret = sim.retoma;
  const retomaMonto = (ret && ret.enabled) ? (Number(ret.precio) || 0) : 0;
  if (retomaMonto > 0) {
    const veh = [ret.marca, ret.modelo].filter(Boolean).map(escHtml).join(' ');
    const km = ret.kilometraje ? ` · ${Number(ret.kilometraje).toLocaleString('es-MX')} km` : '';
    rows.push(row(`Vehículo de retoma${veh ? ` (${veh}${km})` : ''}`, `−${money(retomaMonto)}`, null, 'is-credit'));
  }

  const total = sim.total != null ? Number(sim.total) : Math.max(0, precioNeto - retomaMonto);

  const notes = notesArray(sim.specialNotes);
  const notaHtml = notes.length ? `
    <div class="re-note">
      <span class="re-note-title">Nota</span>
      ${notes.map(n => `<p>* ${escHtml(n)}</p>`).join('')}
    </div>` : '';

  $('view').innerHTML = `
    <div class="re-eyebrow">Cotización</div>
    <div class="re-brand-row">
      <span class="re-wordmark">Royal Enfield<small>GLG Motomex</small></span>
      <span class="re-tag">Pago de contado</span>
    </div>
    <div class="re-rule"></div>

    ${sim.modelo ? `<div class="re-vehicle">${escHtml(sim.modelo)}${sim.cilindrada ? ` · ${escHtml(String(sim.cilindrada))} cc` : ''}</div>` : ''}

    <div class="re-hero">
      <div class="re-hero-label">Total a pagar</div>
      <div class="re-total">${money(total)}</div>
      <div class="re-sub">Sin financiamiento · sujeta a disponibilidad</div>
    </div>

    ${notaHtml}

    <div class="re-rows">
      ${rows.join('')}
      <div class="re-row re-total-row"><span class="re-row-k">Total a pagar</span><span class="re-row-v">${money(total)}</span></div>
    </div>

    <p class="re-foot">Cotización de contado con Royal Enfield GLG Motomex. Precio sujeto a disponibilidad del modelo.</p>
  `;
}

// ---------------- Render (solo lectura, con marca del banco) ----------------
function render(sim) {
  if (sim.contado) return renderContado(sim);
  const t = BANK_THEME[sim.banco] || BANK_THEME.bbva;
  document.body.className = 'skin-' + sim.banco;
  document.body.style.setProperty('--bank', t.color);
  fitToHostPage(false);

  $('loading').style.display = 'none';
  $('error').style.display = 'none';
  $('view').style.display = 'block';

  const financiar = (sim.precio && sim.enganche != null) ? sim.precio - sim.enganche : null;
  const row = (label, value, sub) => `<div class="rv-row"><span class="rv-k">${escHtml(label)}${sub ? `<small>${escHtml(sub)}</small>` : ''}</span><span class="rv-v">${value}</span></div>`;

  // Descuento (opcional): el Site 1 guarda `precio` NETO, más `precioLista` y `descuento`.
  const descuento = Number(sim.descuento) || 0;
  const precioLista = Number(sim.precioLista) || sim.precio;
  const conDescuento = descuento > 0;

  const rows = [];
  if (sim.precio) rows.push(row('Precio del vehículo', money(conDescuento ? precioLista : sim.precio)));
  if (conDescuento) rows.push(row('Descuento', `<span class="rv-desc">−${money(descuento)}</span>`));
  if (sim.enganche != null) rows.push(row('Enganche', money(sim.enganche), `${sim.enganchePct}% del precio`));
  if (financiar != null) rows.push(row('Monto a financiar', money(financiar)));
  if (sim.cxa != null) rows.push(row('Comisión por apertura', money(sim.cxa)));
  if (sim.seguro != null) rows.push(row('Seguro', money(sim.seguro)));
  if (sim.seguroVida != null) rows.push(row('Seguro de vida y desempleo', money(sim.seguroVida)));

  // Disclaimer de vehículo de retoma (parte de pago), si el asesor lo marcó en el Site 1.
  const ret = sim.retoma;
  let retomaHtml = '';
  if (ret && ret.enabled && (ret.precio || ret.marca || ret.modelo)) {
    const fmtCur = (n, cur) => { try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur || 'MXN', minimumFractionDigits: 2 }).format(Number(n) || 0); } catch (e) { return money(n); } };
    const veh = [ret.marca, ret.modelo].filter(Boolean).map(escHtml).join(' ');
    const valor = fmtCur(ret.precio, ret.moneda);
    const km = ret.kilometraje ? ` · ${Number(ret.kilometraje).toLocaleString('es-MX')} km` : '';
    retomaHtml = `<div class="rv-retoma" style="border-color:${t.color}">
      <span class="rv-retoma-ic" style="background:${t.color}">↺</span>
      <span class="rv-retoma-txt">Esta cotización cuenta con un <strong>vehículo de retoma${veh ? ` (${veh}${km})` : ''}</strong> por valor de <strong style="color:${t.color}">${valor} ${escHtml(ret.moneda || 'MXN')}</strong>.</span>
    </div>`;
  }

  // Nota especial (pública) del producto, si el asesor la guardó en el Site 1.
  const notes = notesArray(sim.specialNotes);
  // Nota especial: texto dentro del recuadro de la cuota, a la derecha.
  const notaInner = notes.length
    ? `<span class="rv-hero-note-title">Nota</span>${notes.map(n => `<p>* ${escHtml(n)}</p>`).join('')}`
    : '';

  const logoHtml = t.img
    ? `<img class="rv-logo-img" src="${t.img}" alt="${escHtml(t.name)}">`
    : `<span class="rv-logo" style="color:${t.color}">${escHtml(t.logo)}</span>`;
  $('view').innerHTML = `
    <div class="rv-brand" style="border-color:${t.color}">
      ${logoHtml}
      <span class="rv-tag">Simulación de financiamiento</span>
    </div>
    ${sim.modelo ? `<div class="rv-vehicle">
      <span class="rv-vehicle-name">${escHtml(sim.modelo)}</span>
      ${sim.cilindrada ? `<span class="rv-vehicle-sku">${escHtml(String(sim.cilindrada))} cc</span>` : ''}
    </div>` : ''}

    <div class="rv-hero${notes.length ? ' rv-hero-2' : ''}">
      <div class="rv-hero-main">
        <div class="rv-hero-label">Cuota mensual</div>
        <div class="rv-cuota" style="color:${t.color}">${money(sim.cuota)}</div>
        <div class="rv-hero-sub">Tasa ${pct(sim.tasa)} anual · ${escHtml(String(sim.plazo))} meses</div>
      </div>
      ${notes.length ? `<div class="rv-hero-note">${notaInner}</div>` : ''}
    </div>

    <div class="rv-rows">${rows.join('')}</div>

    <div class="rv-totals">
      ${row('Pago inicial', money(sim.pagoInicial), 'Enganche + comisión por apertura')}
      <div class="rv-row rv-total"><span class="rv-k">Importe total a pagar</span><span class="rv-v" style="color:${t.color}">${money(sim.total)}</span></div>
    </div>

    ${retomaHtml}

    <p class="rv-note">Simulación informativa con ${escHtml(sim.bancoName)}. Los seguros se financian dentro de la cuota; el pago inicial (enganche + comisión) no se financia. Sujeto a aprobación de crédito.</p>
  `;
}

function showError(msg) {
  $('loading').style.display = 'none';
  $('view').style.display = 'none';
  $('error').style.display = 'block';
  $('error').textContent = msg;
}

// ---------------- postMessage (respaldo si el host envía el modelo) ----------------
function onMessage(event) {
  const d = event.data || {};
  if (!d.type || !['form:get:model:response', 'form:model:response', 'site:init'].includes(d.type)) return;
  let pl = d.payload;
  if (typeof pl === 'string') { try { pl = JSON.parse(pl); } catch (e) { /* noop */ } }
  const deal = (pl && (pl.value || pl.deal || pl)) || {};
  const sim = extractSim(deal);
  if (sim) render(sim);
}
function requestModel() {
  let origin = '*';
  try { if (document.referrer) origin = new URL(document.referrer).origin; } catch (e) { /* noop */ }
  window.parent.postMessage({ type: 'form:get:model', payload: JSON.stringify({ modelName: 'deal' }) }, origin);
}

// ---------------- Init ----------------
async function init() {
  window.addEventListener('message', onMessage);

  const params = new URLSearchParams(window.location.search);

  // Vista previa local del diseño: ?preview=santander|bbva|banregio|contado
  const pv = params.get('preview');
  if (IS_LOCAL && pv === 'contado') {
    return render({
      contado: true, modelo: 'Classic 350',
      sku: 'pl-2025_classic-halcyon-green', precioLista: 119900, descuento: 5000,
      precio: 114900, total: 72900,
      specialNotes: ['Incluye casco de regalo y primer servicio gratis.'],
      retoma: { enabled: true, marca: 'Honda', modelo: 'CB 190R', kilometraje: 18500, precio: 42000, moneda: 'MXN' },
    });
  }
  if (IS_LOCAL && pv) {
    const bank = BANK_THEME[pv] ? pv : 'santander';
    return render({
      banco: bank, bancoName: BANK_THEME[bank].name, modelo: 'Classic 350',
      sku: 'pl-2025_classic-halcyon-green', precioLista: 119900, descuento: 5000,
      precio: 114900, tasa: 0.1799, enganchePct: 20,
      enganche: 22980, plazo: 36, cxa: 2758, seguro: 7500, seguroVida: 1800,
      pagoInicial: 25738, cuota: 3659, total: 157462,
      specialNotes: ['Incluye casco de regalo y primer servicio gratis.', 'Promoción válida hasta fin de mes.'],
      retoma: { enabled: true, marca: 'Honda', modelo: 'CB 190R', kilometraje: 18500, precio: 42000, moneda: 'MXN' },
    });
  }

  const dealId = params.get('dealId');
  if (dealId) {
    const contactId = params.get('contactId') || 'none';
    try {
      const deal = await fetchDeal(`https://${DOMAIN}/view/deal/${dealId}/${contactId}/?format=json`);
      const sim = extractSim(deal);
      return sim ? render(sim) : showError('Esta propuesta no tiene una simulación de crédito guardada.');
    } catch (e) { return showError('No se pudo cargar la simulación: ' + e.message); }
  }

  if (window.parent !== window) {
    requestModel();
    const info = parseDealUrl();
    if (info) {
      try {
        const deal = await fetchDeal(info.jsonUrl);
        const sim = extractSim(deal);
        return sim ? render(sim) : showError('Esta propuesta no tiene una simulación de crédito guardada.');
      } catch (e) { console.warn('[cotizador] fetchDeal por URL falló, esperando postMessage:', e.message); }
    } else {
      console.warn('[cotizador] no se pudo extraer el id del Deal de la URL del host:', document.referrer || '(sin referrer)');
    }
    setTimeout(() => { if ($('view').style.display === 'none') showError('No se encontró la simulación de crédito en esta propuesta.'); }, 4000);
  } else {
    showError('Abre esta simulación desde una propuesta (o usa ?dealId=... para probar).');
  }
}

document.addEventListener('DOMContentLoaded', init);
