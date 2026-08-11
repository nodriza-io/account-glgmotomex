/* eslint-env browser */
/**
 * Skins fieles por banco (+ el skin "contado", sin financiamiento). Cada uno
 * usa los MISMOS ids de control y de salida, así el orquestador (calculator.js)
 * los maneja de forma idéntica:
 *   Controles:  f_modelo, f_precio, f_enganche (+f_engToggle), f_plazo,
 *               f_descuento (+f_descToggle), f_guardar
 *   Salidas:    o_cuota, o_tasa, o_engPct, o_enganche, o_financiar,
 *               o_cxaPct, o_cxa, o_seguro1, o_seguro2, o_inicial, o_total
 *               (contado usa además o_ctPrecio, o_ctRetomaRow, o_ctRetoma)
 */

// Filas del desglose reutilizables (varían solo por clases de estilo)
function breakdownRows(cls) {
  return `
    <div class="${cls}-row"><span>Tasa anual fija</span><span id="o_tasa">0%</span></div>
    <div class="${cls}-row"><span>Enganche <small id="o_engPct"></small></span><span id="o_enganche">$0</span></div>
    <div class="${cls}-row"><span>Costo a financiar</span><span id="o_financiar">$0</span></div>
    <div class="${cls}-row"><span>Comisión por apertura <small id="o_cxaPct"></small></span><span id="o_cxa">$0</span></div>
    <div class="${cls}-row"><span>Seguro</span><span id="o_seguro1">$0</span></div>
    <div class="${cls}-row"><span>Seguro de vida y desempleo</span><span id="o_seguro2">$0</span></div>
    <div class="${cls}-row ${cls}-row-strong"><span>Pago inicial total</span><span id="o_inicial">$0</span></div>
    <div class="${cls}-row ${cls}-row-total"><span>Importe total a pagar</span><span id="o_total">$0</span></div>`;
}

// Campo de descuento (compartido por los 3 skins). Vive dentro de la calculadora,
// junto al enganche/plazo. NO se muestra en el Site 2 (que lee del sim guardado).
function descuentoField() {
  return `
    <div class="calc-desc">
      <div class="calc-desc-head">Descuento <span class="calc-desc-tag">no aparece en la cotización del cliente</span></div>
      <div class="calc-desc-row">
        <input id="f_descuento" class="calc-desc-inp" type="text" inputmode="numeric" placeholder="0" autocomplete="off">
        <div class="calc-desc-tg" id="f_descToggle">
          <button type="button" data-mode="val" class="calc-tg active">$</button>
          <button type="button" data-mode="pct" class="calc-tg">%</button>
        </div>
      </div>
    </div>`;
}

// Campo de enganche (compartido por los 3 skins). Toggle %/$: el asesor puede
// teclear el enganche como % del precio (el modo de siempre) o como un monto
// fijo en pesos; el motor ajusta la tasa según el % efectivo que resulte, sin
// permitir bajar del mínimo que exige el banco para la cilindrada elegida.
function engancheField() {
  return `
    <div class="calc-desc">
      <div class="calc-desc-head">Enganche</div>
      <div class="calc-desc-row">
        <input id="f_enganche" class="calc-desc-inp" type="text" inputmode="numeric" placeholder="20" autocomplete="off">
        <div class="calc-desc-tg" id="f_engToggle">
          <button type="button" data-mode="pct" class="calc-tg active">%</button>
          <button type="button" data-mode="val" class="calc-tg">$</button>
        </div>
      </div>
      <div class="calc-desc-hint" id="f_engHint"></div>
    </div>`;
}

const SKINS = {
  // ======================= BBVA (clon "Simula tu Crédito de Vehículo") =======================
  bbva: () => `
    <div class="bbva">
      <div class="bbva-logo-row"><img class="bank-logo" src="logo-bbva.svg" alt="BBVA" style="height:30px;width:auto;display:block"></div>
      <div class="bbva-grid">
        <div class="bbva-left">
          <h1 class="bbva-title">Simula tu Crédito de Vehículo</h1>
          <p class="bbva-sub">Elige el modelo y las condiciones para conocer tu cuota mensual.</p>
          <div class="bbva-field"><div class="bbva-select"><select id="f_modelo"></select><span class="bbva-chevron">⌄</span></div></div>
          <div class="bbva-field"><div class="bbva-input-affix"><input id="f_precio" readonly tabindex="-1" class="bbva-input" type="text" inputmode="numeric" placeholder="Valor del vehículo"><span class="bbva-affix">$</span></div></div>
          ${engancheField()}
          <div class="bbva-field"><div class="bbva-select"><select id="f_plazo"></select><span class="bbva-chevron">⌄</span></div></div>
          <p class="bbva-note"><span class="bbva-i">i</span> La tasa se ajusta según el enganche. Cotización informativa.</p>
          ${descuentoField()}
          <button id="f_guardar" class="bbva-btn">Guardar en la propuesta</button>
        </div>
        <aside class="bbva-card">
          <div class="bbva-cuota" id="o_cuota">$0</div>
          <div class="bbva-cuota-label">Cuota mensual con seguros</div>
          <div class="bbva-costs">
            <div class="bbva-costs-head"><span>Tasas y costos</span></div>
            <div class="bbva-costs-body">${breakdownRows('bbva')}</div>
          </div>
          <p class="bbva-card-note"><span class="bbva-i">i</span> Valores aproximados. Las condiciones finales dependen de la aprobación del banco.</p>
        </aside>
      </div>
    </div>`,

  // ======================= SANTANDER (rojo) =======================
  santander: () => `
    <div class="stdr">
      <div class="stdr-logo-row"><img class="bank-logo" src="logo-santander.svg" alt="Santander" style="height:26px;width:auto;display:block"></div>
      <div class="stdr-grid">
        <div class="stdr-left">
          <h1 class="stdr-title">Simula tu cuota</h1>
          <p class="stdr-sub">Elige tu moto y arma el plan de financiamiento a tu medida.</p>
          <label class="stdr-label">Modelo</label>
          <div class="stdr-field"><select id="f_modelo" class="stdr-ctrl"></select></div>
          <label class="stdr-label">Precio del vehículo</label>
          <div class="stdr-field stdr-affix"><span class="stdr-cur">$</span><input id="f_precio" readonly tabindex="-1" class="stdr-ctrl" type="text" inputmode="numeric"></div>
          ${engancheField()}
          <label class="stdr-label">Plazo</label>
          <div class="stdr-field"><select id="f_plazo" class="stdr-ctrl"></select></div>
          ${descuentoField()}
          <button id="f_guardar" class="stdr-btn">Guardar en la propuesta</button>
        </div>
        <aside class="stdr-card">
          <div class="stdr-card-label">Tu cuota mensual</div>
          <div class="stdr-cuota" id="o_cuota">$0</div>
          <div class="stdr-rows">${breakdownRows('stdr')}</div>
          <p class="stdr-note">Cotización informativa sujeta a aprobación.</p>
        </aside>
      </div>
    </div>`,

  // ======================= BANREGIO (naranja) =======================
  banregio: () => `
    <div class="bnr">
      <div class="bnr-logo-row"><span class="bnr-logo">Ban<span class="bnr-logo-accent">regio</span></span></div>
      <div class="bnr-grid">
        <div class="bnr-left">
          <h1 class="bnr-title">Simulador <span class="bnr-accent">Crédito Moto</span></h1>
          <p class="bnr-sub">Cotízalo a tu medida en nuestro simulador de crédito. ¡Queremos apoyarte!</p>
          <h3 class="bnr-section">Características</h3>
          <div class="bnr-fields">
            <select id="f_modelo" class="bnr-ctrl"></select>
            <div class="bnr-affix"><input id="f_precio" readonly tabindex="-1" class="bnr-ctrl" type="text" inputmode="numeric" placeholder="Precio del vehículo"><span class="bnr-cur">$</span></div>
            <select id="f_plazo" class="bnr-ctrl"></select>
          </div>
          ${engancheField()}
          ${descuentoField()}
          <button id="f_guardar" class="bnr-btn">Guardar cotización</button>
        </div>
        <aside class="bnr-card">
          <div class="bnr-pago-label">Pago de</div>
          <div class="bnr-cuota" id="o_cuota">$0.00</div>
          <h3 class="bnr-resumen">Resumen</h3>
          ${breakdownRows('bnr')}
        </aside>
      </div>
    </div>`,

  // ======================= CONTADO (sin financiamiento) =======================
  contado: () => `
    <div class="bbva">
      <div class="bbva-logo-row"><span class="glg-logo-sub">Pago de contado</span></div>
      <div class="bbva-grid">
        <div class="bbva-left">
          <h1 class="bbva-title">Pago de contado</h1>
          <p class="bbva-sub">Sin financiamiento — el cliente paga el total directamente.</p>
          <div class="bbva-field"><div class="bbva-select"><select id="f_modelo"></select><span class="bbva-chevron">⌄</span></div></div>
          <div class="bbva-field"><div class="bbva-input-affix"><input id="f_precio" readonly tabindex="-1" class="bbva-input" type="text" inputmode="numeric" placeholder="Valor del vehículo"><span class="bbva-affix">$</span></div></div>
          ${descuentoField()}
          <button id="f_guardar" class="bbva-btn">Guardar en la propuesta</button>
        </div>
        <aside class="bbva-card">
          <div class="bbva-cuota" id="o_cuota">$0</div>
          <div class="bbva-cuota-label">Total a pagar de contado</div>
          <div class="bbva-costs">
            <div class="bbva-costs-body">
              <div class="bbva-row"><span>Precio del vehículo</span><span id="o_ctPrecio">$0</span></div>
              <div class="bbva-row" id="o_ctRetomaRow" style="display:none;"><span>Vehículo de retoma</span><span id="o_ctRetoma">−$0</span></div>
              <div class="bbva-row bbva-row-strong bbva-row-total"><span>Total a pagar</span><span id="o_total">$0</span></div>
            </div>
          </div>
          <p class="bbva-card-note"><span class="bbva-i">i</span> Cotización de contado, sin financiamiento.</p>
        </aside>
      </div>
    </div>`,
};
