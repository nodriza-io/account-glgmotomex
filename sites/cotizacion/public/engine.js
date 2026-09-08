/* eslint-env browser */
/* global BANKS */
/**
 * Motor de cálculo compartido por todos los skins de banco.
 * No toca el DOM: recibe datos y devuelve números.
 *
 * Hay DOS modelos:
 *   - Genérico (Santander / Banregio): un solo crédito, cuota fija, sin IVA.
 *   - BBVA: modelo real del banco. Ver `calcularBBVA`.
 */

/**
 * Devuelve el TRAMO que aplica al enganche del cliente: el de mayor `minEng`
 * que el enganche alcanza (si no llega a ninguno, el más bajo).
 *
 * Cada fila del Sheet es un caso completo — banco + cilindrada + tramo de
 * enganche — y puede traer su propio seguro de daños y su propio seguro de
 * vida, no solo su tasa. Un enganche más alto puede tener otra póliza.
 * Si el tramo no trae seguros propios (caso de la matriz embebida en data.js,
 * donde viven a nivel de cilindrada), se usan los de la cilindrada.
 */
function resolveTramo(cil, engPct) {
  const tiers = [...cil.tiers].sort((a, b) => b.minEng - a.minEng);
  let t = tiers[tiers.length - 1];
  for (const x of tiers) { if (engPct >= x.minEng) { t = x; break; } }
  return {
    rate: t.rate,
    seguro: t.seguro != null ? t.seguro : cil.seguro,
    seguroVida: t.seguroVida != null ? t.seguroVida : cil.seguroVida,
  };
}

// Cuota de un crédito francés: capital `pv` a `n` meses con tasa mensual `i`.
function pmt(i, n, pv) {
  if (!pv || !n) return 0;
  if (!i) return pv / n;
  return pv * i / (1 - Math.pow(1 + i, -n));
}

/* ============================================================================
   MODELO DE CRÉDITO — parametrizado por banco
   ----------------------------------------------------------------------------
   El modelo se dedujo de la cotización real BBVA No. 54288845 (Meteor 350
   Aurora Black, $107,990, enganche 20%, 36 meses, 17.99%): reproduce el pago
   mensual y el total con 0.03% de desviación.

   Son TRES créditos paralelos que se pagan juntos, no uno solo:
     · vehículo         -> se amortiza a `plazo` meses
     · seguro de daños  -> prima ANUAL: se amortiza a 12 meses y se RENUEVA en
       los meses 13/25/37/49. A 36 meses se pagan 3 primas, no 1.
     · seguro de vida   -> se amortiza a `plazo` meses

   Cuatro reglas son PARÁMETROS, porque cada banco puede manejarlas distinto.
   Se configuran en `bank.modelo` (data.js):

     iva            IVA sobre los intereses de cada mes, nunca sobre el capital.
                    Es lo que hace que la mensualidad NO sea fija: baja con los
                    intereses y sube al renovar el seguro. 0 = el banco no lo cobra.
     seguroAnual    true  -> la prima de daños se renueva cada 12 meses.
                    false -> se financia una sola vez a todo el plazo.
     cxaSobreTotal  true  -> comisión sobre vehículo + los dos seguros.
                    false -> solo sobre el vehículo.
     cxaConIva      true  -> la comisión lleva IVA.
     diasMes        Conteo de intereses. 30.4375 (365.25/12) reproduce el
                    actual/360 del banco sobre el calendario real; 30 equivale a
                    tasa/12. Con 30.4375 la tasa mensual da 1.5210% en vez de
                    1.4992%: sin ese ajuste la cuota sale ~0.4% baja.

   Con `iva: 0`, `seguroAnual: false`, `cxaSobreTotal: false`, `cxaConIva: false`
   y `diasMes: 30`, el modelo colapsa exactamente en la fórmula francesa simple
   de un solo crédito — PMT es lineal en el capital, así que los tres créditos
   paralelos suman lo mismo que uno por el total. Sirve de escape hatch.

   Lo que NO se replica: el "pago irregular" de arranque, los días sueltos entre
   la disposición del crédito y el primer corte. Depende de la fecha real de
   disposición, que no se conoce al cotizar. En la cotización de referencia son
   $655.57 sobre un total de $162,751.88 (0.4%).
   ========================================================================== */
const MODELO_DEFAULT = {
  iva: 0.16,
  seguroAnual: true,
  cxaSobreTotal: true,
  cxaConIva: true,
  diasMes: 30.4375,
};

function calcularCredito({ banco, precioNeto, enganchePct, plazo, tramo, tasa, cxaPct, modelo }) {
  const M = Object.assign({}, MODELO_DEFAULT, modelo || {});
  const i = tasa / 360 * M.diasMes;

  const enganche = precioNeto * (enganchePct / 100);
  const financiar = precioNeto - enganche;
  const seguro = tramo.seguro;         // prima de daños (anual si M.seguroAnual)
  const seguroVida = tramo.seguroVida; // se amortiza a todo el plazo

  // "Monto Total a Financiar": vehículo + los dos seguros.
  const montoFinanciado = financiar + seguro + seguroVida;
  const baseCxa = M.cxaSobreTotal ? montoFinanciado : financiar;
  const cxaMonto = baseCxa * cxaPct * (M.cxaConIva ? 1 + M.iva : 1); // de contado
  const pagoInicial = enganche + cxaMonto;

  // Cada cuánto se renueva la prima de daños. Sin renovación, se amortiza una
  // sola vez a todo el plazo.
  const cicloSeguro = M.seguroAnual ? 12 : plazo;

  const baseAuto = pmt(i, plazo, financiar);
  const baseVida = pmt(i, plazo, seguroVida);

  let sAuto = financiar, sDanios = 0, sVida = seguroVida;
  let baseDanios = 0, primas = 0;
  const cuotas = [];
  let totalCuotas = 0, totalIva = 0, totalIntereses = 0;

  for (let m = 1; m <= plazo; m++) {
    // Renovación de la prima. Si al plazo le quedan menos meses que el ciclo,
    // la última prima se amortiza en lo que resta.
    if ((m - 1) % cicloSeguro === 0) {
      sDanios = seguro;
      baseDanios = pmt(i, Math.min(cicloSeguro, plazo - m + 1), seguro);
      primas++;
    }
    const intAuto = sAuto * i; sAuto -= (baseAuto - intAuto);
    const intDanios = sDanios * i; sDanios -= (baseDanios - intDanios);
    const intVida = sVida * i; sVida -= (baseVida - intVida);

    const intereses = intAuto + intDanios + intVida;
    const iva = intereses * M.iva;
    const cuota = baseAuto + baseDanios + baseVida + iva;

    cuotas.push(cuota);
    totalCuotas += cuota; totalIva += iva; totalIntereses += intereses;
  }

  const cuotaMin = Math.min.apply(null, cuotas);
  const cuotaMax = Math.max.apply(null, cuotas);

  return {
    tasa, enganche, financiar, cxaMonto, pagoInicial,
    seguro, seguroVida,
    principal: montoFinanciado,
    cuota: cuotas[0],                 // 1er pago: el que el banco titula "Pago Mensual con IVA"
    totalPagar: totalCuotas + pagoInicial,
    modelo: banco,
    // La mensualidad varía si hay IVA sobre intereses o si el seguro se renueva
    // dentro del plazo. Es lo que decide si la UI muestra el rango o un número fijo.
    cuotaVaria: (cuotaMax - cuotaMin) > 0.005,
    cuotas,                           // mensualidad mes a mes
    cuotaMin, cuotaMax,
    totalCuotas,                      // suma de las mensualidades, sin el pago inicial
    totalIva, totalIntereses,
    primasSeguro: primas,             // cuántas primas de daños entran en el plazo
    tasaMensual: i,
    ivaPct: M.iva,
  };
}

/**
 * calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo })
 * -> { tasa, enganche, financiar, cxaMonto, pagoInicial, seguro, seguroVida,
 *      principal, cuota, totalPagar, modelo, cuotaVaria, cuotas,
 *      cuotaMin, cuotaMax, totalCuotas, totalIva, totalIntereses,
 *      primasSeguro, tasaMensual, ivaPct }
 */
function calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo, descuento }) {
  const bank = BANKS[banco];
  const cil = bank && bank.cilindradas ? bank.cilindradas[cilindrada] : null;
  if (!bank || !cil) return null;

  const precioNeto = Math.max(0, (precio || 0) - (descuento || 0)); // descuento aplicado al modelo
  const tramo = resolveTramo(cil, enganchePct);

  return calcularCredito({
    banco, precioNeto, enganchePct, plazo, tramo,
    tasa: tramo.rate, cxaPct: bank.cxa, modelo: bank.modelo,
  });
}

// Formateadores compartidos
const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('es-MX');
const fmtPct = v => (v * 100).toFixed(2).replace(/\.00$/, '') + '%';
