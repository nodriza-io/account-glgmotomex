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
 *   Calc.setContado(bool)          Activa/desactiva el modo "pago de contado".
 *   Calc.setRetomaMonto(monto)     Sincroniza el valor del vehículo de retoma (afecta el total de contado).
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
    engancheMode: 'pct', // 'pct' = % del precio, 'val' = monto fijo en $
    engancheMonto: null, // último monto tecleado en modo $ (null = nunca se tocó / modo %)
    plazo: 36,
    descuento: 0,
    retomaMonto: 0,       // valor del vehículo de retoma (solo afecta el total en modo contado)
    quotedLocked: false,
    contado: false,       // true = pago de contado, omite banco/tasa/plazo
  };
  let onSave = null;
  let descMode = 'val'; // 'val' = monto en $, 'pct' = porcentaje

  const precioNeto = () => Math.max(0, (state.precio || 0) - (state.descuento || 0));
  const bankCil = () => BANKS[state.banco].cilindradas[state.cilindrada];

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

  // --- Enganche (% del precio o monto fijo en $, según state.engancheMode) ---
  // Ambos caminos terminan fijando state.enganchePct (el % EFECTIVO), que es lo
  // único que engine.js necesita para resolver la tasa del tramo correspondiente.
  // Nunca se permite bajar del mínimo que exige el banco para la cilindrada elegida.
  function applyEngPct(pct) {
    const cil = bankCil();
    let hitMin = false;
    let clamped = pct;
    if (clamped < cil.minEng) { clamped = cil.minEng; hitMin = true; }
    if (clamped > cil.maxEng) clamped = cil.maxEng;
    state.enganchePct = clamped;
    if (state.engancheMode === 'val') state.engancheMonto = Math.round(precioNeto() * clamped / 100);
    return hitMin;
  }
  function applyEngMonto(monto) {
    const cil = bankCil();
    const pn = precioNeto();
    let pct = pn > 0 ? (monto / pn) * 100 : 0;
    let hitMin = false;
    if (pct < cil.minEng) { pct = cil.minEng; hitMin = true; }
    if (pct > cil.maxEng) pct = cil.maxEng;
    state.enganchePct = pct;
    state.engancheMonto = Math.round(pn * pct / 100);
    return hitMin;
  }
  // Re-evalúa el enganche actual contra el banco/cilindrada/precio vigentes
  // (cambia si cambia el modelo, el precio o el descuento). Devuelve si tuvo
  // que ajustar al mínimo.
  function resyncEnganche() {
    if (state.engancheMode === 'val' && state.engancheMonto != null) return applyEngMonto(state.engancheMonto);
    return applyEngPct(state.enganchePct);
  }
  // Refleja state.enganchePct/engancheMonto + engancheMode en el campo del skin.
  function fillEngancheField(hitMin) {
    const tg = $('f_engToggle');
    if (tg) tg.querySelectorAll('.calc-tg').forEach(x => x.classList.toggle('active', x.dataset.mode === state.engancheMode));
    const inp = $('f_enganche');
    if (inp) {
      if (state.engancheMode === 'val') {
        const monto = state.engancheMonto != null ? state.engancheMonto : Math.round(precioNeto() * state.enganchePct / 100);
        inp.value = Math.round(monto).toLocaleString('es-MX');
      } else {
        // Muestra el % redondeado al entero más cercano (el cálculo real usa el
        // % preciso internamente; esto es solo para no mostrar decimales largos).
        inp.value = String(Math.round(state.enganchePct));
      }
    }
    paintEngHint(!!hitMin);
  }
  function paintEngHint(hitMin) {
    const hint = $('f_engHint'); if (!hint) return;
    const cil = bankCil();
    if (hitMin) {
      hint.textContent = `El enganche mínimo de ${BANKS[state.banco].name} para esta cilindrada es ${cil.minEng}%. No puede ser menor.`;
      hint.classList.add('warn');
    } else {
      hint.textContent = `Mínimo permitido: ${cil.minEng}%`;
      hint.classList.remove('warn');
    }
  }

  function normalizeForBank() {
    if (state.contado) return;
    const cil = bankCil();
    resyncEnganche();
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

  function fillPlazo() {
    const cil = bankCil();
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
    if (state.contado) return renderContado();
    const r = calcularFinanciamiento(state);
    if (!r) return null;
    const bank = BANKS[state.banco];
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const pr = $('f_precio'); if (pr) pr.value = fmtNum.format(Math.max(0, state.precio - (state.descuento || 0))); // precio con descuento
    set('o_cuota', state.banco === 'banregio' ? fmtMXN.format(r.cuota) : fmtMXN0.format(r.cuota));
    set('o_tasa', fmtPct(r.tasa));
    set('o_engPct', `(${Math.round(state.enganchePct)}%)`);
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

  // Modo contado: sin banco/tasa/plazo. Total = precio neto de descuento − retoma.
  function renderContado() {
    const pn = precioNeto();
    const ret = state.retomaMonto || 0;
    const total = Math.max(0, pn - ret);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const pr = $('f_precio'); if (pr) pr.value = fmtNum.format(pn);
    set('o_ctPrecio', fmtMXN.format(pn));
    const retRow = $('o_ctRetomaRow');
    if (ret > 0) { if (retRow) retRow.style.display = ''; set('o_ctRetoma', '−' + fmtMXN.format(ret)); }
    else if (retRow) retRow.style.display = 'none';
    set('o_cuota', fmtMXN0.format(total));
    set('o_total', fmtMXN.format(total));
    return { precioNeto: pn, retomaMonto: ret, total };
  }

  function wireControls() {
    const mo = $('f_modelo');
    if (mo && !state.quotedLocked) mo.addEventListener('change', e => {
      const o = e.target.selectedOptions[0];
      state.modelo = o.value; state.cilindrada = +o.dataset.cilindrada; state.precio = +o.dataset.precio;
      $('f_precio').value = fmtNum.format(state.precio);
      normalizeForBank(); fillEngancheField(); fillPlazo(); render();
    });
    // f_precio es de solo lectura (el precio viene del producto; el descuento se ajusta aparte).
    const eg = $('f_enganche');
    if (eg) {
      eg.addEventListener('input', () => {
        const raw = parseFloat(String(eg.value).replace(/[^\d.]/g, '')) || 0;
        const hit = state.engancheMode === 'val' ? applyEngMonto(raw) : applyEngPct(raw);
        paintEngHint(hit);
        render();
      });
      eg.addEventListener('blur', () => fillEngancheField());
    }
    const etg = $('f_engToggle');
    if (etg) etg.addEventListener('click', e => {
      const b = e.target.closest('.calc-tg'); if (!b || b.dataset.mode === state.engancheMode) return;
      state.engancheMode = b.dataset.mode; // el número cambia de significado (% ↔ $)
      etg.querySelectorAll('.calc-tg').forEach(x => x.classList.toggle('active', x === b));
      if (state.engancheMode === 'val') state.engancheMonto = Math.round(precioNeto() * state.enganchePct / 100);
      fillEngancheField();
      render();
    });
    const pl = $('f_plazo');
    if (pl) pl.addEventListener('change', e => { state.plazo = +e.target.value; render(); });
    const dd = $('f_descuento');
    if (dd) {
      dd.addEventListener('input', () => {
        state.descuento = descMonto();
        const hit = resyncEnganche();
        fillEngancheField(hit);
        render();
      });
      dd.addEventListener('blur', () => { if (descMode === 'val') { const v = Math.round(rawDescInput()); dd.value = v ? v.toLocaleString('es-MX') : ''; } });
    }
    const dt = $('f_descToggle');
    if (dt) dt.addEventListener('click', e => {
      const b = e.target.closest('.calc-tg'); if (!b || b.dataset.mode === descMode) return;
      descMode = b.dataset.mode; // el número cambia de significado ($ ↔ %)
      dt.querySelectorAll('.calc-tg').forEach(x => x.classList.toggle('active', x === b));
      if (dd) { dd.value = ''; state.descuento = 0; dd.focus(); }
      resyncEnganche(); fillEngancheField();
      render();
    });
    const gd = $('f_guardar');
    if (gd) gd.addEventListener('click', () => { const r = render(); if (r && onSave) onSave(r, snapshot()); });
  }

  function mountBank(key) {
    state.banco = key;
    state.contado = false;
    normalizeForBank();
    document.body.className = 'skin-' + key;
    document.querySelectorAll('.glg-tab').forEach(t => t.classList.toggle('active', t.dataset.bank === key));
    $('skinMount').innerHTML = SKINS[key]();
    fillModelos(); fillEngancheField(); fillPlazo(); wireControls(); fillDescuento(); render();
  }

  function mountContado() {
    state.contado = true;
    document.body.className = 'skin-contado';
    $('skinMount').innerHTML = SKINS.contado();
    fillModelos(); wireControls(); fillDescuento(); render();
  }

  function setVehicle(v) {
    if (v.cilindrada) state.cilindrada = v.cilindrada;
    if (v.precio) state.precio = v.precio;
    if (v.nombre) state.modelo = v.nombre;
    if (v.locked) state.quotedLocked = true;
    state.descuento = 0; descMode = 'val'; // nuevo producto → sin descuento
    if (state.contado) { mountContado(); } else { normalizeForBank(); mountBank(state.banco); }
  }

  // Descuento al modelo (monto en $). El motor calcula sobre precio - descuento.
  function setDescuento(monto) {
    state.descuento = Math.max(0, monto || 0);
    render();
  }

  // Activa/desactiva el modo "pago de contado" sin perder el resto del estado
  // (modelo, precio, descuento). El banco elegido queda en memoria para cuando
  // se desmarque.
  function setContado(on) {
    const next = !!on;
    if (next === state.contado) return;
    if (next) mountContado(); else mountBank(state.banco);
  }

  // Sincroniza el valor del vehículo de retoma (0 si no aplica). Solo afecta
  // el cálculo en modo contado (en modo crédito es puramente informativo y lo
  // maneja el Site 2).
  function setRetomaMonto(monto) {
    state.retomaMonto = Math.max(0, monto || 0);
    if (state.contado) render();
  }

  // Carga una cotización existente (modo editar): vehículo + banco + enganche + plazo + descuento.
  function loadQuote(v) {
    if (v.cilindrada) state.cilindrada = v.cilindrada;
    if (v.precio) state.precio = v.precio;
    if (v.nombre) state.modelo = v.nombre;
    if (v.banco && BANKS[v.banco]) state.banco = v.banco;
    state.engancheMode = v.engancheMode === 'val' ? 'val' : 'pct';
    state.engancheMonto = (v.engancheMode === 'val' && v.enganche != null) ? v.enganche : null;
    if (v.enganchePct != null) state.enganchePct = v.enganchePct;
    if (v.plazo != null) state.plazo = v.plazo;
    state.descuento = v.descuento || 0;
    descMode = v.descMode === 'pct' ? 'pct' : 'val';
    state.quotedLocked = !!v.locked;
    state.contado = !!v.contado;
    if (state.contado) { mountContado(); } else { normalizeForBank(); mountBank(state.banco); }
  }

  // Vuelve a los valores por defecto (modo crear tras haber editado).
  function reset() {
    state.quotedLocked = false;
    state.cilindrada = MODELOS[0].cilindrada;
    state.precio = MODELOS[0].precio;
    state.modelo = MODELOS[0].nombre;
    state.enganchePct = 20;
    state.engancheMode = 'pct';
    state.engancheMonto = null;
    state.plazo = 36;
    state.descuento = 0; descMode = 'val';
    state.retomaMonto = 0;
    state.contado = false;
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

  return {
    init, mountBank, setVehicle, setDescuento, setContado, setRetomaMonto, loadQuote, reset,
    getState: () => snapshot(), getResult: () => (state.contado ? renderContado() : calcularFinanciamiento(state)),
  };
})();
