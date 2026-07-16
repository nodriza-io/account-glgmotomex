/* eslint-env browser */
/* global BANKS */
/**
 * Motor de cálculo compartido por todos los skins de banco.
 * No toca el DOM: recibe datos y devuelve números.
 */

// Devuelve la MEJOR tasa (menor) cuyo minEng <= enganche del cliente.
function resolveTasa(cil, engPct) {
  const tiers = [...cil.tiers].sort((a, b) => b.minEng - a.minEng);
  for (const t of tiers) if (engPct >= t.minEng) return t.rate;
  return tiers[tiers.length - 1].rate;
}

/**
 * calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo })
 * -> { tasa, enganche, financiar, cxaMonto, pagoInicial, seguro, seguroVida,
 *      principal, cuota, totalPagar }
 */
function calcularFinanciamiento({ banco, cilindrada, precio, enganchePct, plazo, descuento }) {
  const bank = BANKS[banco];
  const cil = bank && bank.cilindradas ? bank.cilindradas[cilindrada] : null;
  if (!bank || !cil) return null;

  const precioNeto = Math.max(0, (precio || 0) - (descuento || 0)); // descuento aplicado al modelo
  const tasa = resolveTasa(cil, enganchePct);
  const enganche = precioNeto * (enganchePct / 100);
  const financiar = precioNeto - enganche;         // costo a financiar
  const cxaMonto = financiar * bank.cxa;           // comisión por apertura
  const pagoInicial = enganche + cxaMonto;         // enganche + CxA (no se financia)

  const principal = financiar + cil.seguro + cil.seguroVida;  // seguros financiados
  const i = tasa / 12;
  const cuota = principal * i / (1 - Math.pow(1 + i, -plazo));
  const totalPagar = cuota * plazo + pagoInicial;

  return {
    tasa, enganche, financiar, cxaMonto, pagoInicial,
    seguro: cil.seguro, seguroVida: cil.seguroVida,
    principal, cuota, totalPagar,
  };
}

// Formateadores compartidos
const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('es-MX');
const fmtPct = v => (v * 100).toFixed(2).replace(/\.00$/, '') + '%';
