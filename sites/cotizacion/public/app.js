/* eslint-env browser */
/* global BANKS, Calc, findModeloBySku, MODELOS, PRECIO_DEFAULT */
/**
 * Site 1 — Cotizador del asesor (GLG Royal Enfield).
 * Sesión de Prolibu (sin login propio) → menú Crear/Editar → calculadora de bancos → crea/actualiza Deal.
 * La simulación se guarda en customFields (fin*). El Site 2 (cotizador) la lee en modo solo lectura.
 */
const $ = id => document.getElementById(id);
const CFG = window.__PROLIBU_CONFIG__ || {};
const IS_LOCAL = /^(localhost|127\.0\.0\.1|)$/.test(window.location.hostname);
const HOST = CFG.domain || (IS_LOCAL ? 'glgmotomex.prolibu.com' : window.location.hostname);
const API_BASE = CFG.apiBaseUrl || `https://${HOST}/v2`;
const KEY = 'apiKey'; // clave compartida con el SPA de Prolibu (misma origin)
const SIGNIN_URL = `https://${HOST}/v2/auth/signin`;
const DEALS_URL = `https://${HOST}/ui/spa/suite/deals`;
const BANK_KEY_BY_NAME = { Santander: 'santander', BBVA: 'bbva', Banregio: 'banregio' };

let editMode = false;
let contactId = null;
let selectedProduct = null; // {pbeId, productCode, productName, price}
const state = { dealId: null, dealCode: null };

const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Convierte un texto con separadores/moneda a número (para precios de retoma, etc.).
const parseMoney = s => { const n = parseFloat(String(s == null ? '' : s).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };

// ---------------- API ----------------
function getKey() { return localStorage.getItem(KEY) || ''; }
async function api(path, opts = {}) {
  return fetch(`${API_BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getKey()}`, ...(opts.headers || {}) } });
}

// ---------------- Auth (sesión de Prolibu) ----------------
async function validateSession() {
  if (!getKey()) return false;
  try {
    const res = await api('/user/me');
    if (res.status !== 200) return false;
    const me = await res.json();
    try { localStorage.setItem('me', JSON.stringify(me)); } catch (e) { /* noop */ }
    const p = me.profile || me;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || 'Usuario';
    ['userName', 'userNameC'].forEach(id => { if ($(id)) $(id).textContent = name; });
    sessionStorage.removeItem('glg_auth_redirected');
    return true;
  } catch (e) { return false; }
}
function redirectToSignin() {
  if (sessionStorage.getItem('glg_auth_redirected')) {
    showNotice('No pudimos validar tu sesión', 'Inicia sesión en Prolibu y vuelve a abrir el cotizador.', 'Ir al login de Prolibu', SIGNIN_URL);
    return;
  }
  sessionStorage.setItem('glg_auth_redirected', '1');
  localStorage.removeItem(KEY); localStorage.removeItem('me');
  window.location.href = `${SIGNIN_URL}?redirect=${encodeURIComponent(window.location.href)}`;
}
function showNotice(title, msg, btnText, btnHref) {
  ['appView', 'chooserView'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
  $('noticeTitle').textContent = title;
  $('noticeMsg').textContent = msg;
  const b = $('noticeBtn'); b.textContent = btnText; b.setAttribute('href', btnHref);
  $('noticeView').style.display = 'flex';
}
function logout() { localStorage.removeItem(KEY); localStorage.removeItem('me'); window.location.href = SIGNIN_URL; }
function goTo(url) {
  try { if (window.top && window.top !== window.self) { window.top.location.href = url; return; } } catch (e) { /* cross-origin */ }
  window.location.href = url;
}
// Genera una short url de Prolibu (/r/xxxx) para el link largo. Si falla, devuelve el largo.
async function shortenUrl(longUrl) {
  try {
    const r = await api('/shorturl/generate', { method: 'POST', body: JSON.stringify({ url: longUrl }) });
    if (r.status < 400) { const j = await r.json(); if (j && j.link) return j.link; }
  } catch (e) { /* fallback al link largo */ }
  return longUrl;
}

// Popup de éxito con opciones: enviar por WhatsApp/correo al lead, abrir la cotización, cerrar.
async function showSuccess(title, dealId) {
  const editUrl = `https://${HOST}/ui/spa/suite/deals/edit/${dealId}`;
  const previewUrl = `https://${HOST}/ui/spa/view/deal/${dealId}/${contactId || 'none'}`;
  const nombre = ($('cNombre').value || '').trim();
  const email = ($('cEmail').value || '').trim();
  const rawTel = ($('cTel').value || '').trim();
  const telDigits = rawTel.replace(/\D/g, '');
  const tel = telDigits ? (rawTel.startsWith('+') ? telDigits : getTelCode() + telDigits) : ''; // usa el código de país elegido
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';

  $('modalTitle').textContent = title;
  const wa = $('mBtnWa'), mail = $('mBtnMail'), open = $('mBtnOpen'), copy = $('mBtnCopy');

  // Abrir la cotización SIEMPRE en una pestaña nueva.
  open.href = editUrl;
  open.onclick = e => { e.preventDefault(); window.open(editUrl, '_blank', 'noopener'); };

  // Al cerrar, dos caminos: crear una nueva cotización o editar la recién creada.
  $('mBtnNew').onclick = () => { $('modal').style.display = 'none'; enterCreate(); };
  $('mBtnEdit').onclick = () => { $('modal').style.display = 'none'; enterEdit(); cargarDeal(dealId); };

  // Copiar el link (short url) de la propuesta. Mientras se genera, copia el largo.
  let currentShareUrl = previewUrl;
  copy.textContent = 'Copiar link de la propuesta'; copy.classList.remove('is-copied');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(currentShareUrl); }
    catch (e) {
      const t = document.createElement('textarea'); t.value = currentShareUrl;
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (_) { /* noop */ }
      t.remove();
    }
    copy.textContent = '✓ Link copiado'; copy.classList.add('is-copied');
    clearTimeout(copy._t); copy._t = setTimeout(() => { copy.textContent = 'Copiar link de la propuesta'; copy.classList.remove('is-copied'); }, 1800);
  };

  wa.style.display = 'none'; mail.style.display = 'none';
  $('modal').style.display = 'flex';

  // La short url es lo que viaja al lead y lo que se copia.
  const shareUrl = await shortenUrl(previewUrl);
  currentShareUrl = shareUrl;
  const msg = `${saludo} te comparto tu cotización de financiamiento GLG: ${shareUrl}`;
  if (tel) { wa.style.display = ''; wa.href = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`; }
  if (email) { mail.style.display = ''; mail.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Tu cotización GLG')}&body=${encodeURIComponent(msg)}`; }
}

// ---------------- Navegación crear/editar ----------------
function showChooser() {
  ['noticeView', 'appView'].forEach(id => { $(id).style.display = 'none'; });
  $('chooserView').style.display = 'block'; window.scrollTo(0, 0);
}
function enterCreate() {
  editMode = false; state.dealId = null; state.dealCode = null;
  $('chooserView').style.display = 'none'; $('appView').style.display = 'block'; window.scrollTo(0, 0);
  $('editLoadCard').style.display = 'none';
  resetForm();
  showMainCard(true); showCalc(false); // crear: form visible, calculadora hasta elegir producto
  $('pageTitle').textContent = 'Nueva cotización';
  Calc.reset();
}
function enterEdit() {
  editMode = true; state.dealId = null; state.dealCode = null;
  $('chooserView').style.display = 'none'; $('appView').style.display = 'block'; window.scrollTo(0, 0);
  $('editLoadCard').style.display = 'block';
  resetForm();
  showMainCard(false); showCalc(false); // editar: todo oculto hasta cargar un deal
  $('pageTitle').textContent = 'Editar cotización';
  $('editSearch').focus();
}
function resetForm() {
  contactId = null; selectedProduct = null;
  ['dealTitle', 'cSearch', 'cEmail', 'cNombre', 'cApellido', 'cTel', 'cDocType', 'cDocId', 'editSearch', 'pSearch', 'rMarca', 'rModelo', 'rKm', 'rPrecio'].forEach(id => { if ($(id)) $(id).value = ''; });
  ['cStatus', 'editStatus'].forEach(id => { if ($(id)) $(id).textContent = ''; });
  ['editResults', 'cResults'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });
  if ($('contactFields')) $('contactFields').style.display = 'none';
  setRetoma(null); // limpia y oculta el módulo de vehículo de retoma
  fillTelCodes(); if ($('cTelCode')) $('cTelCode').value = '52';
  $('quotedBanner').style.display = 'none';
}
function showContactFields() { if ($('contactFields')) $('contactFields').style.display = 'block'; }
// Paso a paso: el formulario y la calculadora se muestran cuando corresponde.
function showMainCard(v) { const el = $('dealForm'); if (el) el.style.display = v ? '' : 'none'; }
function showCalc(v) { ['bankTabs', 'skinMount'].forEach(id => { const el = $(id); if (el) el.style.display = v ? '' : 'none'; }); }

// ---------------- Vehículo de retoma (parte de pago) ----------------
function toggleRetoma() { const on = $('retomaCheck') && $('retomaCheck').checked; if ($('retomaModule')) $('retomaModule').style.display = on ? '' : 'none'; }
// Devuelve el objeto de retoma para el sim (o null si el check está apagado / sin datos).
function getRetoma() {
  if (!$('retomaCheck') || !$('retomaCheck').checked) return null;
  const precio = parseMoney($('rPrecio').value);
  const marca = ($('rMarca').value || '').trim();
  const modelo = ($('rModelo').value || '').trim();
  if (!marca && !modelo && !precio) return null; // check activo pero vacío → no guarda retoma
  return {
    enabled: true,
    marca, modelo,
    kilometraje: parseInt(String($('rKm').value || '').replace(/[^\d]/g, ''), 10) || 0,
    precio, moneda: ($('rMoneda').value || 'MXN'),
  };
}
// Restaura el módulo de retoma desde el sim (modo editar) o lo limpia (null).
function setRetoma(ret) {
  const on = !!(ret && ret.enabled);
  if ($('retomaCheck')) $('retomaCheck').checked = on;
  if ($('retomaModule')) $('retomaModule').style.display = on ? '' : 'none';
  if ($('rMarca')) $('rMarca').value = on ? (ret.marca || '') : '';
  if ($('rModelo')) $('rModelo').value = on ? (ret.modelo || '') : '';
  if ($('rKm')) $('rKm').value = on && ret.kilometraje ? Number(ret.kilometraje).toLocaleString('es-MX') : '';
  if ($('rPrecio')) $('rPrecio').value = on && ret.precio ? Math.round(ret.precio).toLocaleString('es-MX') : '';
  if ($('rMoneda')) $('rMoneda').value = (on && ret.moneda) || 'MXN';
}

// ---------------- Contacto ----------------
// Busca por nombre, correo, teléfono o documento (/contact/search).
let cliTimer = null;
function onClienteInput(e) {
  const term = e.target.value.trim();
  clearTimeout(cliTimer);
  if (term.length < 2) { $('cResults').classList.remove('open'); return; }
  cliTimer = setTimeout(() => buscarCliente(term), 300);
}
async function buscarCliente(term) {
  term = (term || $('cSearch').value || '').trim();
  if (!term) { $('cStatus').textContent = 'Escribe nombre, correo, teléfono o documento.'; return; }
  try {
    const res = await api(`/contact/search?limit=8&term=${encodeURIComponent(term)}`);
    let items = [];
    if (res.status === 200) { const d = await res.json(); items = d.data || d.rows || (Array.isArray(d) ? d : []); }
    renderClientes(items, term);
  } catch (e) { renderClientes([], term); }
}
function renderClientes(items, term) {
  const box = $('cResults');
  const nuevo = `<div class="s1-presult s1-presult-new" data-new="1">+ Registrar cliente nuevo<small>${escAttr(term)}</small></div>`;
  const list = items.slice(0, 8).map((c, i) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Contacto';
    const meta = [c.email, c.mobile, c.identification && c.identification.docId].filter(Boolean).join(' · ');
    return `<div class="s1-presult" data-i="${i}">${escAttr(name)}<small>${escAttr(meta)}</small></div>`;
  }).join('');
  box.innerHTML = (items.length ? list : '<div class="s1-presult"><small>Sin resultados.</small></div>') + nuevo;
  box.classList.add('open');
  box.querySelectorAll('.s1-presult').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.new) { nuevoCliente(term); return; }
      const i = +el.dataset.i; if (!isNaN(i)) seleccionarContacto(items[i]);
    });
  });
}
// Setea el select de tipo de documento; si el valor cargado no está en la lista, lo agrega.
function setDocType(val) {
  const sel = $('cDocType'); if (!sel) return;
  val = val || '';
  if (val && !Array.from(sel.options).some(o => o.value === val || o.textContent === val)) {
    const o = document.createElement('option'); o.textContent = val; o.value = val; sel.appendChild(o);
  }
  sel.value = val;
}
function fillContact(c) {
  $('cSearch').value = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '';
  $('cEmail').value = c.email || ''; $('cNombre').value = c.firstName || ''; $('cApellido').value = c.lastName || '';
  setTelFromStored(c.mobile || c.whatsapp || ''); // detecta el código de país y muestra el local
  const idn = c.identification || {}; setDocType(idn.docType); $('cDocId').value = idn.docId || '';
  $('cStatus').textContent = `Cliente: ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}`;
  showContactFields();
}
function seleccionarContacto(c) {
  contactId = c._id || c.id;
  $('cResults').classList.remove('open');
  fillContact(c);
  $('cStatus').textContent = `✅ Cliente: ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}`;
}
function nuevoCliente(term) {
  contactId = null;
  $('cResults').classList.remove('open');
  $('cEmail').value = /@/.test(term) ? term : ''; $('cNombre').value = ''; $('cApellido').value = ''; $('cTel').value = ''; $('cDocType').value = ''; $('cDocId').value = '';
  $('cStatus').textContent = 'Cliente nuevo. Completa los datos y se creará al cotizar.';
  showContactFields();
  $('cNombre').focus();
}
// ---------------- Teléfono con código de país dinámico ----------------
const TEL_CODES = [
  { c: '52', flag: '🇲🇽', name: 'México' },
  { c: '1', flag: '🇺🇸', name: 'EE. UU. / Canadá' },
  { c: '57', flag: '🇨🇴', name: 'Colombia' },
  { c: '54', flag: '🇦🇷', name: 'Argentina' },
  { c: '56', flag: '🇨🇱', name: 'Chile' },
  { c: '51', flag: '🇵🇪', name: 'Perú' },
  { c: '593', flag: '🇪🇨', name: 'Ecuador' },
  { c: '502', flag: '🇬🇹', name: 'Guatemala' },
  { c: '503', flag: '🇸🇻', name: 'El Salvador' },
  { c: '504', flag: '🇭🇳', name: 'Honduras' },
  { c: '505', flag: '🇳🇮', name: 'Nicaragua' },
  { c: '506', flag: '🇨🇷', name: 'Costa Rica' },
  { c: '507', flag: '🇵🇦', name: 'Panamá' },
  { c: '591', flag: '🇧🇴', name: 'Bolivia' },
  { c: '598', flag: '🇺🇾', name: 'Uruguay' },
  { c: '595', flag: '🇵🇾', name: 'Paraguay' },
  { c: '58', flag: '🇻🇪', name: 'Venezuela' },
  { c: '55', flag: '🇧🇷', name: 'Brasil' },
  { c: '34', flag: '🇪🇸', name: 'España' },
];
function fillTelCodes() {
  const sel = $('cTelCode'); if (!sel || sel.options.length) return;
  TEL_CODES.forEach(t => {
    const o = document.createElement('option');
    o.value = t.c; o.textContent = `${t.flag} +${t.c}`; o.title = t.name;
    sel.appendChild(o);
  });
  sel.value = '52'; // México por defecto
}
function getTelCode() { const s = $('cTelCode'); return (s && s.value) || '52'; }
// Número completo para guardar en el contacto: +<código> <local>.
function getMobile() {
  const raw = ($('cTel').value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw; // ya viene internacional completo
  return `+${getTelCode()} ${raw}`;
}
// Al cargar un contacto: detecta el código del número guardado y lo selecciona.
function setTelFromStored(v) {
  const sel = $('cTelCode'); fillTelCodes();
  const s = String(v || '').trim();
  if (!s) { $('cTel').value = ''; if (sel) sel.value = '52'; return; }
  const digits = s.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    const num = digits.slice(1);
    const match = TEL_CODES.map(t => t.c).sort((a, b) => b.length - a.length).find(c => num.startsWith(c));
    if (match) { if (sel) sel.value = match; $('cTel').value = num.slice(match.length); return; }
  }
  $('cTel').value = s.replace(/^\+/, ''); if (sel) sel.value = '52';
}
async function ensureContacto() {
  if (contactId) return contactId;
  const email = $('cEmail').value.trim();
  if (!email) throw new Error('Falta el correo del cliente.');
  const body = { firstName: $('cNombre').value.trim(), lastName: $('cApellido').value.trim(), email, mobile: getMobile() };
  const docType = $('cDocType').value.trim(), docId = $('cDocId').value.trim();
  if (docType || docId) body.identification = { docType, docId };
  const res = await api('/contact/', { method: 'POST', body: JSON.stringify(body) });
  if (res.status >= 400) { const e = await res.json().catch(() => ({})); throw new Error('Contacto: ' + (e.message || res.status)); }
  const c = await res.json(); contactId = c._id || c.id; return contactId;
}

// ---------------- Producto ----------------
let searchTimer = null;
function onProductInput(e) {
  const term = e.target.value.trim();
  clearTimeout(searchTimer);
  if (term.length === 0) { searchTimer = setTimeout(listarProductos, 150); return; } // vacío → muestra la lista
  if (term.length < 2) return;
  searchTimer = setTimeout(() => buscarProductos(term), 300);
}
async function buscarProductos(term) {
  try {
    const res = await api(`/pricebookentry/search?limit=15&term=${encodeURIComponent(term)}`);
    let items = [];
    if (res.status === 200) { const data = await res.json(); items = data.data || data.rows || (Array.isArray(data) ? data : []); }
    renderProductos(items);
  } catch (e) { renderProductos([]); }
}
// Muestra los primeros productos del pricebook al hacer clic en el buscador (sin escribir).
async function listarProductos() {
  try {
    const res = await api('/pricebookentry?limit=25&populate=product');
    let items = [];
    if (res.status === 200) { const data = await res.json(); items = data.data || data.rows || []; }
    renderProductos(items);
  } catch (e) { /* noop */ }
}

// El descuento vive dentro de la calculadora (calculator.js/skins.js); aquí solo se lee del estado.
// El resultado de /pricebookentry/search trae nombre y SKU dentro de `product`.
function pbeName(p) { const pr = p.product || {}; return pr.productName || p.productName || pr.productCode || p.pricebookEntryCode || 'Producto'; }
function pbeCode(p) { const pr = p.product || {}; return pr.productCode || p.productCode || p.pricebookEntryCode || ''; }

function renderProductos(items) {
  const box = $('pResults');
  if (!items.length) { box.innerHTML = '<div class="s1-presult"><small>Sin resultados.</small></div>'; box.classList.add('open'); return; }
  box.innerHTML = items.slice(0, 15).map((p, i) =>
    `<div class="s1-presult" data-i="${i}">${escAttr(pbeName(p))}<small>${escAttr(pbeCode(p))}</small></div>`
  ).join('');
  box.classList.add('open');
  box.querySelectorAll('.s1-presult').forEach(el => {
    el.addEventListener('click', () => { const i = +el.dataset.i; if (!isNaN(i)) seleccionarProducto(items[i]); });
  });
}
async function seleccionarProducto(p) {
  selectedProduct = { pbeId: p._id, productCode: pbeCode(p), productName: pbeName(p), price: 0 };
  $('pSearch').value = selectedProduct.productName;
  $('pResults').classList.remove('open');
  $('quotedModel').textContent = selectedProduct.productName;
  $('quotedSku').textContent = selectedProduct.productCode ? `SKU ${selectedProduct.productCode}` : '';
  $('quotedBanner').style.display = 'flex';
  // El search no trae precio: lo obtenemos con formatlineitem.
  try {
    const li = await (await api(`/quote/formatlineitem?pricebookEntryId=${p._id}`)).json();
    if (li) {
      selectedProduct.price = li.price || li.netUnitPrice || li.unitPrice || 0;
      if (!selectedProduct.productName || selectedProduct.productName === 'Producto') selectedProduct.productName = li.productName || selectedProduct.productName;
      if (!selectedProduct.productCode) selectedProduct.productCode = li.productCode || '';
      $('pSearch').value = selectedProduct.productName;
      $('quotedModel').textContent = selectedProduct.productName;
    }
  } catch (e) { /* noop */ }
  const cil = cilindradaDeSku(selectedProduct.productCode, selectedProduct.productName); // clasificación desde el Sheet (o data.js)
  // Si el pricebook trae un precio placeholder (muy bajo), usa el precio indicativo por cilindrada.
  if (cil && (!selectedProduct.price || selectedProduct.price < 1000)) selectedProduct.price = PRECIO_DEFAULT[cil] || selectedProduct.price;
  if (cil) {
    Calc.setVehicle({ cilindrada: cil, precio: selectedProduct.price || PRECIO_DEFAULT[cil], nombre: selectedProduct.productName, locked: true });
    showCalc(true); // recién al elegir un producto con tabla aparece la calculadora (con su campo de descuento)
  } else {
    $('quotedSku').textContent = (selectedProduct.productCode ? `SKU ${selectedProduct.productCode} · ` : '') + 'sin tabla de financiamiento';
    showCalc(false);
  }
}

// ---------------- Editar: buscar y cargar Deal ----------------
// Busca por nombre del negocio (deal) Y por contacto (nombre, correo, teléfono, documento).
async function buscarDeals() {
  const term = $('editSearch').value.trim(), st = $('editStatus');
  if (!term) { st.textContent = 'Escribe negocio, contacto, correo o teléfono.'; return; }
  st.textContent = 'Buscando...'; $('editResults').innerHTML = '';
  const enc = encodeURIComponent(term);
  const POP = `populate=${encodeURIComponent('contact createdBy')}`;
  // /deal/search devuelve una proyección reducida (sin createdAt): pedimos los campos con select.
  const SEL = `select=${encodeURIComponent('dealName contact proposal dealCode createdBy createdAt')}`;
  const getData = r => (r && r.ok ? r.json() : Promise.resolve({})).then(j => (j && (j.data || j.rows)) || []).catch(() => []);
  try {
    // 1) Deals cuyo nombre/título/código matchea
    const byName = api(`/deal/search?limit=10&term=${enc}&${POP}&${SEL}`).then(getData).catch(() => []);
    // 2) Contactos que matchean → sus deals
    const byContact = api(`/contact/search?limit=5&term=${enc}`).then(getData).then(async contacts => {
      const lists = await Promise.all(contacts.slice(0, 5).map(c =>
        api(`/deal?contact=${c._id || c.id}&limit=5&${POP}`).then(getData).catch(() => [])));
      return lists.flat();
    }).catch(() => []);

    const [dealsName, dealsContact] = await Promise.all([byName, byContact]);
    const seen = new Set(), deals = [];
    [...dealsName, ...dealsContact].forEach(d => { const id = d && (d._id || d.id); if (id && !seen.has(id)) { seen.add(id); deals.push(d); } });

    if (!deals.length) { st.textContent = 'Sin resultados. Probá con otro término.'; return; }
    st.textContent = `${deals.length} resultado(s):`;
    $('editResults').innerHTML = deals.slice(0, 15).map(renderDealCard).join('');
  } catch (e) { st.textContent = 'No se pudo buscar: ' + e.message; }
}

function fmtFecha(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}
function renderDealCard(d) {
  const title = (d.proposal && d.proposal.title) || d.dealName || '(sin título)';
  const c = d.contact && typeof d.contact === 'object' ? d.contact : {};
  const cb = d.createdBy && typeof d.createdBy === 'object' ? d.createdBy : {};
  const contactName = [c.firstName, c.lastName].filter(Boolean).join(' ');
  const creator = [cb.firstName, cb.lastName].filter(Boolean).join(' ') || cb.email || '';
  const fecha = fmtFecha(d.createdAt);
  const creatorLine = creator
    ? `Creada por ${creator}${fecha ? ` · ${fecha}` : ''}`
    : (fecha ? `Creada el ${fecha}` : '');
  const contactLine = [contactName, c.email, c.mobile || c.whatsapp].filter(Boolean).map(escAttr).join(' · ');
  return `<button class="glg-res" data-id="${escAttr(d._id)}" type="button">
    <span class="glg-res-main">
      <span class="glg-res-title">${escAttr(title)}</span>
      ${creatorLine ? `<span class="glg-res-creator">${escAttr(creatorLine)}</span>` : ''}
      ${contactLine ? `<span class="glg-res-meta">${contactLine}</span>` : ''}
    </span>
    <span class="glg-res-go">Editar →</span>
  </button>`;
}

async function cargarDeal(id) {
  const st = $('editStatus'); st.textContent = 'Cargando Deal...';
  try {
    const res = await api(`/deal/${id}`);
    if (res.status >= 400) throw new Error('HTTP ' + res.status);
    const deal = await res.json();
    state.dealId = deal._id; state.dealCode = deal.dealCode || deal._id;
    $('dealTitle').value = (deal.proposal && deal.proposal.title) || deal.dealName || '';
    // Contacto
    const c = deal.contact;
    if (c && typeof c === 'object') { contactId = c._id || c.id || null; fillContact(c); }
    else if (typeof c === 'string') { contactId = c; try { const cr = await api(`/contact/${c}`); if (cr.ok) fillContact(await cr.json()); } catch (e) { /* noop */ } }
    showContactFields();
    // Simulación guardada (un solo custom field JSON). Fallback al lineItem para el producto.
    const raw = deal.customFields && deal.customFields.simulacionCredito;
    let sim = null;
    if (raw) { try { sim = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { sim = null; } }
    const li = deal.proposal && deal.proposal.quote && deal.proposal.quote.lineItems && deal.proposal.quote.lineItems[0];
    let sku = sim && sim.sku, nombre = sim && sim.modelo, precio = sim && (sim.precioLista || sim.precio), pbeId = sim && sim.pbeId;
    if (li) {
      sku = sku || li.sku || li.productCode || (li.pricebookEntry && (li.pricebookEntry.pricebookEntryCode || li.pricebookEntry.productCode));
      nombre = nombre || li.productName || li.name;
      precio = precio || li.price || li.netUnitPrice || li.unitPrice || 0;
      pbeId = pbeId || li.pricebookEntryId || (li.pricebookEntry && (li.pricebookEntry._id || li.pricebookEntry));
    }
    const cil = cilindradaDeSku(sku, nombre); // clasificación desde el Sheet (o data.js)
    const cilindrada = cil || 350;
    if ((!precio || precio <= 0)) precio = (PRECIO_DEFAULT && PRECIO_DEFAULT[cilindrada]) || 0;
    if (pbeId) selectedProduct = { pbeId: (typeof pbeId === 'object' ? pbeId._id : pbeId), productCode: sku || '', productName: nombre || 'Producto', price: precio };
    if (nombre) {
      $('quotedModel').textContent = nombre || '';
      $('quotedSku').textContent = sku ? `SKU ${sku}` : '';
      $('quotedBanner').style.display = 'flex';
    }
    const bancoKey = (sim && sim.banco) || 'bbva';
    const desc = (sim && sim.descuento) || 0;
    const dmode = (sim && sim.descuentoMode) || 'val';
    // El descuento (monto + modo) se restaura dentro de la calculadora al montar el skin.
    Calc.loadQuote({ cilindrada, precio, nombre: nombre, banco: bancoKey, enganchePct: sim && sim.enganchePct, plazo: sim && sim.plazo, descuento: desc, descMode: dmode, locked: !!cil });
    setRetoma(sim && sim.retoma); // restaura el módulo de vehículo de retoma si existe
    $('editResults').innerHTML = ''; // al elegir una, se ocultan las demás respuestas de la búsqueda
    $('editSearch').value = (deal.proposal && deal.proposal.title) || deal.dealName || $('editSearch').value;
    showMainCard(true); showCalc(true); // recién ahora se muestra el formulario + calculadora
    st.textContent = `✅ Deal cargado: ${deal.dealCode || deal._id}`;
    $('dealForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { st.textContent = 'No se pudo cargar: ' + e.message; }
}

// ---------------- Guardar (crear POST / editar PATCH) ----------------
async function guardarCotizacion(r, st) {
  const modeloNombre = (selectedProduct && selectedProduct.productName) || st.modelo;
  const title = $('dealTitle').value.trim() || `Financiamiento ${modeloNombre}`;
  // TODA la simulación se guarda en UN solo custom field (JSON). El Site 2 lo lee y lo interpreta.
  const sim = {
    banco: st.banco, bancoName: BANKS[st.banco].name,
    modelo: modeloNombre,
    sku: (selectedProduct && selectedProduct.productCode) || '',
    pbeId: (selectedProduct && selectedProduct.pbeId) || null,
    precio: Math.max(0, (st.precio || 0) - (st.descuento || 0)), // NETO: lo que ve el Site 2
    precioLista: st.precio, descuento: st.descuento || 0,         // interno: el Site 2 no lo muestra
    descuentoMode: st.descMode || 'val', descuentoInput: st.descInput || 0,
    tasa: r.tasa, enganchePct: st.enganchePct, enganche: r.enganche, financiar: r.financiar,
    plazo: st.plazo, cxa: r.cxaMonto, seguro: r.seguro, seguroVida: r.seguroVida,
    pagoInicial: r.pagoInicial, cuota: r.cuota, total: r.totalPagar,
    retoma: getRetoma(), // vehículo en parte de pago (el Site 2 muestra un disclaimer si existe)
  };
  const customFields = { simulacionCredito: JSON.stringify(sim) };
  try {
    let quote = null;
    if (selectedProduct && selectedProduct.pbeId) {
      const liRes = await api(`/quote/formatlineitem?pricebookEntryId=${selectedProduct.pbeId}`);
      if (liRes.status < 400) {
        const li = await liRes.json();
        li.quantity = 1;
        // El quote usa el precio del pricebook (pricingMethod List). El descuento va como monto
        // PROPORCIONAL a ese precio, para que siempre sea válido (<= precio) y conserve el % del modelo.
        const calcPrecio = st.precio || li.price || 0;
        const frac = calcPrecio > 0 ? Math.min(0.99, (st.descuento || 0) / calcPrecio) : 0;
        li.discountAmount = Math.round((li.price || 0) * frac * 100) / 100;
        quote = { quoteCurrency: 'MXN', lineItems: [li] };
      }
    }
    const proposal = { enabled: true, title };
    if (quote) proposal.quote = quote;

    if (editMode && state.dealId) {
      const payload = { dealName: title, proposal, customFields };
      const res = await api(`/deal/${state.dealCode || state.dealId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      if (res.status >= 400) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Error ' + res.status); }
      const deal = await res.json();
      return showSuccess('¡Cotización actualizada!', state.dealId);
    }
    if (!selectedProduct || !selectedProduct.pbeId) throw new Error('Selecciona un producto del buscador para cotizar.');
    const cid = await ensureContacto();
    const payload = { dealName: title, contact: cid, proposal, customFields };
    const res = await api('/deal/', { method: 'POST', body: JSON.stringify(payload) });
    if (res.status >= 400) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Error ' + res.status); }
    const deal = await res.json();
    return showSuccess('¡Cotización creada!', deal._id);
  } catch (e) { alert('❌ No se pudo guardar: ' + e.message); }
}

// ---------------- Init ----------------
function wire() {
  fillTelCodes();
  Calc.init({ onSave: guardarCotizacion });
  $('chooseCrear').addEventListener('click', enterCreate);
  $('chooseEditar').addEventListener('click', enterEdit);
  $('backMenuBtn').addEventListener('click', showChooser);
  $('cSearch').addEventListener('input', onClienteInput);
  $('cSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarCliente(); } });
  $('cSearchBtn').addEventListener('click', () => buscarCliente());
  $('pSearch').addEventListener('input', onProductInput);
  $('pSearch').addEventListener('focus', () => { if (!$('pSearch').value.trim()) listarProductos(); });
  $('pSearch').addEventListener('blur', () => setTimeout(() => $('pResults').classList.remove('open'), 200));
  $('cSearch').addEventListener('blur', () => setTimeout(() => $('cResults').classList.remove('open'), 200));
  $('editSearchBtn').addEventListener('click', buscarDeals);
  $('editSearch').addEventListener('keydown', e => { if (e.key === 'Enter') buscarDeals(); });
  $('editResults').addEventListener('click', e => { const b = e.target.closest('.glg-res'); if (b) cargarDeal(b.dataset.id); });
  const rc = $('retomaCheck'); if (rc) rc.addEventListener('change', toggleRetoma);
  const rp = $('rPrecio'); if (rp) rp.addEventListener('blur', e => { const v = parseMoney(e.target.value); e.target.value = v ? v.toLocaleString('es-MX') : ''; });
  const rk = $('rKm'); if (rk) rk.addEventListener('blur', e => { const v = parseInt(String(e.target.value).replace(/[^\d]/g, ''), 10); e.target.value = v ? v.toLocaleString('es-MX') : ''; });
}

async function boot() {
  const ok = await validateSession();
  if (ok) { await Promise.all([loadBankMatrix(), loadModelosMatrix()]); wire(); showChooser(); return; }
  if (IS_LOCAL) { showNotice('Sesión de Prolibu no detectada', 'En local, guarda tu apiKey en localStorage["apiKey"] para probar el cotizador.', 'Ir al login de Prolibu', SIGNIN_URL); return; }
  redirectToSignin();
}

document.addEventListener('DOMContentLoaded', boot);
