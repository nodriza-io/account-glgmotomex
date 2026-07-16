/* eslint-env browser */
/* global BANKS, MODELOS, SKINS, calcularFinanciamiento, fmtMXN, fmtNum, fmtPct */
/**
 * Calculadora compartida (switcher de bancos + skins fieles + motor).
 * La usan los dos sites: la calculadora embebida y el formulario de cotización.
 *
 * API pública (global `Calc`):
 *   Calc.init({ onSave })          Monta el switcher y el skin por defecto.
 *   Calc.setVehicle({ cilindrada, precio, nombre, locked })
 *   Calc.mountBank(key)
 *   Calc.getState() / Calc.getResult()
 */
const Calc = (function () {
  const fmtMXN0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  const $ = id => document.getElementById(id);
  const parseNum = s => { const n = parseFloat(String(s).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };

  const state = {
    banco: 'bbva',
    cilindrada: MODELOS[0].cilindrada,
    precio: MODELOS[0].precio,
    modelo: MODELOS[0].nombre,
    enganchePct: 20,
    plazo: 36,
    descuento: 0,
    quotedLocked: false,
  };
  let onSave = null;
  let descMode = 'val'; // 'val' = monto en $, 'pct' = porcentaje

  // --- Descuento (dentro de la calculadora, junto a enganche/plazo) ---
  function rawDescInput() { const el = $('f_descuento'); return el ? (parseFloat(String(el.value).replace(/[^\d.]/g, '')) || 0) : 0; }
  function descMonto() {
    const raw = rawDescInput();
    return descMode === 'pct' ? Math.round((state.precio || 0) * raw / 100) : Math.round(raw);
  }
  // Instantánea del estado para onSave/getState, incluye el modo y el valor tecleado del descuento.
  function snapshot() { return Object.assign({}, state, { descMode: descMode, descInput: rawDescInput() }); }
  // Refleja state.descuento + descMode en el campo recién montado del skin.
  function fillDescuento() {
    const tg = $('f_descToggle');
    if (tg) tg.querySelectorAll('.calc-tg').forEach(x => x.classList.toggle('active', x.dataset.mode === descMode));
    const inp = $('f_descuento');
    if (inp) {
      if (!state.descuento) inp.value = '';
      else if (descMode === 'pct') inp.value = String(Math.round((state.descuento / (state.precio || 1)) * 100));
      else inp.value = Math.round(state.descuento).toLocaleString('es-MX');
    }
  }

  function normalizeForBank() {
    const cil = BANKS[state.banco].cilindradas[state.cilindrada];
    if (state.enganchePct < cil.minEng) state.enganchePct = cil.minEng;
    if (state.enganchePct > cil.maxEng) state.enganchePct = cil.maxEng;
    if (!cil.plazos.includes(state.plazo)) state.plazo = cil.plazos.includes(36) ? 36 : cil.plazos[0];
  }

  function fillModelos() {
    const sel = $('f_modelo'); if (!sel) return;
    sel.innerHTML = '';
    if (state.quotedLocked) {
      const o = document.createElement('option');
      o.value = state.modelo; o.textContent = state.modelo;
      sel.appendChild(o); sel.value = state.modelo; sel.disabled = true;
    } else {
      MODELOS.forEach(m => {
        const o = document.createElement('option');
        o.value = m.nombre; o.textContent = m.nombre;
        o.dataset.precio = m.precio; o.dataset.cilindrada = m.cilindrada;
        sel.appendChild(o);
      });
      sel.value = state.modelo; sel.disabled = false;
    }
    if ($('f_precio')) $('f_precio').value = fmtNum.format(state.precio);
  }

  function fillEnganche() {
    const cil = BANKS[state.banco].cilindradas[state.cilindrada];
    const sel = $('f_enganche'); if (!sel) return;
    sel.innerHTML = '';
    const opts = new Set([cil.minEng]);
    for (let p = Math.ceil(cil.minEng / 5) * 5; p <= cil.maxEng; p += 5) opts.add(p);
    [...opts].sort((a, b) => a - b).forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = `Enganche ${p}%`;
      sel.appendChild(o);
    });
    sel.value = state.enganchePct;
  }

  function fillPlazo() {
    const cil = BANKS[state.banco].cilindradas[state.cilindrada];
    const sel = $('f_plazo'); if (!sel) return;
    sel.innerHTML = '';
    cil.plazos.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = `${p} meses`;
      sel.appendChild(o);
    });
    sel.value = state.plazo;
  }

  function render() {
    const r = calcularFinanciamiento(state);
    if (!r) return null;
    const bank = BANKS[state.banco];
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const pr = $('f_precio'); if (pr) pr.value = fmtNum.format(Math.max(0, state.precio - (state.descuento || 0))); // precio con descuento
    set('o_cuota', state.banco === 'banregio' ? fmtMXN.format(r.cuota) : fmtMXN0.format(r.cuota));
    set('o_tasa', fmtPct(r.tasa));
    set('o_engPct', `(${state.enganchePct}%)`);
    set('o_enganche', fmtMXN.format(r.enganche));
    set('o_financiar', fmtMXN.format(r.financiar));
    set('o_cxaPct', `(${fmtPct(bank.cxa)})`);
    set('o_cxa', fmtMXN.format(r.cxaMonto));
    set('o_seguro1', fmtMXN.format(r.seguro));
    set('o_seguro2', fmtMXN.format(r.seguroVida));
    set('o_inicial', fmtMXN.format(r.pagoInicial));
    set('o_total', fmtMXN.format(r.totalPagar));
    return r;
  }

  function wireControls() {
    const mo = $('f_modelo');
    if (mo && !state.quotedLocked) mo.addEventListener('change', e => {
      const o = e.target.selectedOptions[0];
      state.modelo = o.value; state.cilindrada = +o.dataset.cilindrada; state.precio = +o.dataset.precio;
      $('f_precio').value = fmtNum.format(state.precio);
      normalizeForBank(); fillEnganche(); fillPlazo(); render();
    });
    // f_precio es de solo lectura (el precio viene del producto; el descuento se ajusta aparte).
    const en = $('f_enganche');
    if (en) en.addEventListener('change', e => { state.enganchePct = +e.target.value; render(); });
    const pl = $('f_plazo');
    if (pl) pl.addEventListener('change', e => { state.plazo = +e.target.value; render(); });
    const dd = $('f_descuento');
    if (dd) {
      dd.addEventListener('input', () => { state.descuento = descMonto(); render(); });
      dd.addEventListener('blur', () => { if (descMode === 'val') { const v = Math.round(rawDescInput()); dd.value = v ? v.toLocaleString('es-MX') : ''; } });
    }
    const dt = $('f_descToggle');
    if (dt) dt.addEventListener('click', e => {
      const b = e.target.closest('.calc-tg'); if (!b || b.dataset.mode === descMode) return;
      descMode = b.dataset.mode; // el número cambia de significado ($ ↔ %)
      dt.querySelectorAll('.calc-tg').forEach(x => x.classList.toggle('active', x === b));
      if (dd) { dd.value = ''; state.descuento = 0; dd.focus(); }
      render();
    });
    const gd = $('f_guardar');
    if (gd) gd.addEventListener('click', () => { const r = render(); if (r && onSave) onSave(r, snapshot()); });
  }

  function mountBank(key) {
    state.banco = key;
    normalizeForBank();
    document.body.className = 'skin-' + key;
    document.querySelectorAll('.glg-tab').forEach(t => t.classList.toggle('active', t.dataset.bank === key));
    $('skinMount').innerHTML = SKINS[key]();
    fillModelos(); fillEnganche(); fillPlazo(); wireControls(); fillDescuento(); render();
  }

  function setVehicle(v) {
    if (v.cilindrada) state.cilindrada = v.cilindrada;
    if (v.precio) state.precio = v.precio;
    if (v.nombre) state.modelo = v.nombre;
    if (v.locked) state.quotedLocked = true;
    state.descuento = 0; descMode = 'val'; // nuevo producto → sin descuento
    normalizeForBank();
    mountBank(state.banco);
  }

  // Descuento al modelo (monto en $). El motor calcula sobre precio - descuento.
  function setDescuento(monto) {
    state.descuento = Math.max(0, monto || 0);
    render();
  }

  // Carga una cotización existente (modo editar): vehículo + banco + enganche + plazo + descuento.
  function loadQuote(v) {
    if (v.cilindrada) state.cilindrada = v.cilindrada;
    if (v.precio) state.precio = v.precio;
    if (v.nombre) state.modelo = v.nombre;
    if (v.banco && BANKS[v.banco]) state.banco = v.banco;
    if (v.enganchePct != null) state.enganchePct = v.enganchePct;
    if (v.plazo != null) state.plazo = v.plazo;
    state.descuento = v.descuento || 0;
    descMode = v.descMode === 'pct' ? 'pct' : 'val';
    state.quotedLocked = !!v.locked;
    normalizeForBank();
    mountBank(state.banco);
  }

  // Vuelve a los valores por defecto (modo crear tras haber editado).
  function reset() {
    state.quotedLocked = false;
    state.cilindrada = MODELOS[0].cilindrada;
    state.precio = MODELOS[0].precio;
    state.modelo = MODELOS[0].nombre;
    state.enganchePct = 20;
    state.plazo = 36;
    state.descuento = 0; descMode = 'val';
    normalizeForBank();
    mountBank(state.banco);
  }

  function init(opts) {
    opts = opts || {};
    onSave = opts.onSave || null;
    const tabs = $('bankTabs');
    if (tabs) tabs.addEventListener('click', e => {
      const btn = e.target.closest('.glg-tab');
      if (btn) mountBank(btn.dataset.bank);
    });
    mountBank(state.banco);
  }

  return { init, mountBank, setVehicle, setDescuento, loadQuote, reset, getState: () => snapshot(), getResult: () => calcularFinanciamiento(state) };
})();
