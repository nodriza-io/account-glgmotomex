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
   BBVA — modelo real del banco
   ----------------------------------------------------------------------------
   Verificado contra la cotización BBVA No. 54288845 (Meteor 350 Aurora Black,
   $107,990, enganche 20%, 36 meses, 17.99%): reproduce el pago mensual y el
   total con una desviación de 0.03%.

   Cuatro reglas lo separan del modelo genérico:

   1. Son TRES créditos paralelos que se pagan juntos, no uno solo:
        · vehículo         -> se amortiza a `plazo` meses
        · seguro de daños  -> es una prima ANUAL: se amortiza a 12 meses y se
          RENUEVA en los meses 13/25/37/49. A 36 meses se pagan 3 primas, no 1.
        · seguro de vida   -> se amortiza a `plazo` meses
   2. IVA 16% SOLO sobre los intereses de cada mes, nunca sobre el capital.
      Por eso la mensualidad NO es fija: baja mes a mes junto con los intereses
      y sube de golpe cada vez que se renueva el seguro de daños.
   3. Comisión por apertura = 3% del monto TOTAL financiado (vehículo + los dos
      seguros) MÁS IVA. Se paga de contado antes de disponer el crédito, no se
      financia.
   4. Los intereses se cuentan actual/360 sobre los días reales del período. Un
      mes promedio del calendario tiene 365.25/12 = 30.4375 días, así que la
      tasa mensual efectiva es tasa/360 × 30.4375 = 1.5210% (y no tasa/12 =
      1.4992%). Sin este ajuste la cuota sale ~0.4% baja.

   Lo que NO se replica: el "pago irregular" de arranque, los días sueltos entre
   la disposición del crédito y el primer corte. Depende de la fecha real de
   disposición, que no se conoce al cotizar. En la cotización de referencia son
   $655.57 sobre un total de $162,751.88 (0.4%).
   ========================================================================== */
const BBVA_IVA = 0.16;
const BBVA_DIAS_MES = 30.4375; // 365.25/12 — mes promedio, para el conteo actual/360

function calcularBBVA({ precioNeto, enganchePct, plazo, tramo, tasa, cxaPct }) {
  const i = tasa / 360 * BBVA_DIAS_MES;

  const enganche = precioNeto * (enganchePct / 100);
  const financiar = precioNeto - enganche;
  const seguro = tramo.seguro;         // prima ANUAL de daños (con IVA), se renueva
  const seguroVida = tramo.seguroVida; // se amortiza a todo el plazo

  // "Monto Total a Financiar" de la cotización BBVA.
  const montoFinanciado = financiar + seguro + seguroVida;
  const cxaMonto = montoFinanciado * cxaPct * (1 + BBVA_IVA); // de contado, con IVA
  const pagoInicial = enganche + cxaMonto;

  const baseAuto = pmt(i, plazo, financiar);
  const baseVida = pmt(i, plazo, seguroVida);

  let sAuto = financiar, sDanios = 0, sVida = seguroVida;
  let baseDanios = 0, primas = 0;
  const cuotas = [];
  let totalCuotas = 0, totalIva = 0, totalIntereses = 0;

  for (let m = 1; m <= plazo; m++) {
    // Renovación anual del seguro de daños. Si al plazo le quedan menos de 12
    // meses, la última prima se amortiza en lo que resta.
    if ((m - 1) % 12 === 0) {
      sDanios = seguro;
      baseDanios = pmt(i, Math.min(12, plazo - m + 1), seguro);
      primas++;
    }
    const intAuto = sAuto * i; sAuto -= (baseAuto - intAuto);
    const intDanios = sDanios * i; sDanios -= (baseDanios - intDanios);
    const intVida = sVida * i; sVida -= (baseVida - intVida);

    const intereses = intAuto + intDanios + intVida;
    const iva = intereses * BBVA_IVA;
    const cuota = baseAuto + baseDanios + baseVida + iva;

    cuotas.push(cuota);
    totalCuotas += cuota; totalIva += iva; totalIntereses += intereses;
  }

  return {
    tasa, enganche, financiar, cxaMonto, pagoInicial,
    seguro, seguroVida,
    principal: montoFinanciado,
    cuota: cuotas[0],                 // 1er pago: es el que BBVA titula "Pago Mensual con IVA"
    totalPagar: totalCuotas + pagoInicial,
    // --- extras del modelo BBVA (los otros bancos no los traen) ---
    modelo: 'bbva',
    cuotaVaria: true,
    cuotas,                           // mensualidad mes a mes
    cuotaMin: Math.min.apply(null, cuotas),
    cuotaMax: Math.max.apply(null, cuotas),
    totalCuotas,                      // suma de las mensualidades, sin el pago inicial
    totalIva, totalIntereses,
    primasSeguro: primas,             // cuántas primas de daños entran en el plazo
    tasaMensual: i,
  };
}

/**
 * calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo })
 * -> { tasa, enganche, financiar, cxaMonto, pagoInicial, seguro, seguroVida,
 *      principal, cuota, totalPagar }
 * BBVA agrega además: modelo, cuotaVaria, cuotas, cuotaMin/cuotaMax,
 * totalCuotas, totalIva, totalIntereses, primasSeguro, tasaMensual.
 */
function calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo, descuento }) {
  const bank = BANKS[banco];
  const cil = bank && bank.cilindradas ? bank.cilindradas[cilindrada] : null;
  if (!bank || !cil) return null;

  const precioNeto = Math.max(0, (precio || 0) - (descuento || 0)); // descuento aplicado al modelo
  const tramo = resolveTramo(cil, enganchePct);
  const tasa = tramo.rate;

  if (banco === 'bbva') {
    return calcularBBVA({ precioNeto, enganchePct, plazo, tramo, tasa, cxaPct: bank.cxa });
  }

  const enganche = precioNeto * (enganchePct / 100);
  const financiar = precioNeto - enganche;         // costo a financiar
  const cxaMonto = financiar * bank.cxa;           // comisión por apertura
  const pagoInicial = enganche + cxaMonto;         // enganche + CxA (no se financia)

  const principal = financiar + tramo.seguro + tramo.seguroVida;  // seguros financiados
  const i = tasa / 12;
  const cuota = principal * i / (1 - Math.pow(1 + i, -plazo));
  const totalPagar = cuota * plazo + pagoInicial;

  return {
    tasa, enganche, financiar, cxaMonto, pagoInicial,
    seguro: tramo.seguro, seguroVida: tramo.seguroVida,
    principal, cuota, totalPagar,
  };
}

// Formateadores compartidos
const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('es-MX');
const fmtPct = v => (v * 100).toFixed(2).replace(/\.00$/, '') + '%';
