/* eslint-env browser */
/**
 * ============================================================================
 *  MATRIZ DE FINANCIAMIENTO — GLG (Royal Enfield México)
 * ============================================================================
 *  Datos extraídos del Excel "GLG - Prolibu - calculadora financiamiento".
 *  Edita aquí las tasas, seguros, comisiones y plazos de cada banco.
 *
 *  Estructura por banco:
 *    cxa      -> Comisión por apertura (fracción, ej. 0.03 = 3%)
 *    enabled  -> Si el banco aparece disponible en el selector
 *    cilindradas[350|450|650]:
 *      plazos       -> Plazos (meses) disponibles
 *      minEng/maxEng-> Rango de enganche permitido (%)
 *      seguro       -> Seguro (monto fijo $)
 *      seguroVida   -> Seguro de vida y desempleo (monto fijo $)
 *      tiers        -> Tasa anual según tramo de enganche.
 *                      Se aplica la MEJOR tasa cuyo minEng <= enganche del cliente.
 * ============================================================================
 *
 *  ✅ CONFIRMADO CON GLG (jul 2026):
 *   - Valores por moto/cilindrada según el Excel (tasas, seguros, CxA, plazos).
 *   - Seguro de vida y desempleo = $1,800 (Santander) / $5,000 (BBVA) / $2,600-$3,000 (Banregio).
 *   - CxA por banco: Santander 3%, BBVA 3%, Banregio 2%. Va en el PAGO INICIAL (enganche + CxA).
 *   - Pago inicial total = enganche + CxA (no se financia).
 *   - Seguros: se financian dentro de la cuota.
 *   - Crédito Go: deshabilitado (sin tabla todavía).
 *
 *  PENDIENTE:
 *   - Lista real de modelos (nombre + precio + cilindrada) -> GLG la envía. Ver MODELOS abajo.
 */

const BANKS = {
  santander: {
    name: 'Santander',
    enabled: true,
    cxa: 0.03,
    cilindradas: {
      350: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 7500,  seguroVida: 1800, tiers: [{ minEng: 20, rate: 0.1799 }] },
      450: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 9500,  seguroVida: 1800, tiers: [{ minEng: 20, rate: 0.1799 }] },
      650: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 13000, seguroVida: 1800, tiers: [{ minEng: 20, rate: 0.1799 }] },
    },
  },

  bbva: {
    name: 'BBVA',
    enabled: true,
    cxa: 0.03,
    cilindradas: {
      350: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 9500,  seguroVida: 5000, tiers: [{ minEng: 40, rate: 0.1349 }, { minEng: 35, rate: 0.1549 }, { minEng: 20, rate: 0.1799 }] },
      450: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 14500, seguroVida: 5000, tiers: [{ minEng: 40, rate: 0.1349 }, { minEng: 35, rate: 0.1549 }, { minEng: 20, rate: 0.1799 }] },
      650: { plazos: [12, 24, 36, 48, 60], minEng: 20, maxEng: 60, seguro: 16500, seguroVida: 5000, tiers: [{ minEng: 40, rate: 0.1349 }, { minEng: 35, rate: 0.1549 }, { minEng: 20, rate: 0.1799 }] },
    },
  },

  banregio: {
    name: 'Banregio',
    enabled: true,
    cxa: 0.02,
    cilindradas: {
      350: { plazos: [12, 24, 36, 48],     minEng: 15, maxEng: 60, seguro: 8500,  seguroVida: 2600, tiers: [{ minEng: 30, rate: 0.1599 }, { minEng: 15, rate: 0.1649 }] },
      450: { plazos: [12, 24, 36, 48, 60], minEng: 10, maxEng: 60, seguro: 9500,  seguroVida: 3000, tiers: [{ minEng: 30, rate: 0.1275 }, { minEng: 10, rate: 0.1349 }] },
      650: { plazos: [12, 24, 36, 48, 60], minEng: 10, maxEng: 60, seguro: 14500, seguroVida: 3000, tiers: [{ minEng: 30, rate: 0.1275 }, { minEng: 10, rate: 0.1799 }] },
    },
  },

  creditogo: {
    name: 'Crédito Go',
    enabled: false, // Sin datos en el Excel todavía
    cxa: 0,
    cilindradas: {},
  },
};

/**
 * Familias de modelo (para el selector en modo standalone / prueba).
 * El precio es indicativo: en modo embebido el precio real viene del producto cotizado.
 */
const MODELOS = [
  { nombre: 'Meteor 350',        cilindrada: 350, precio: 114900 },
  { nombre: 'Hunter 350',        cilindrada: 350, precio: 91990 },
  { nombre: 'Classic 350',       cilindrada: 350, precio: 119900 },
  { nombre: 'Guerrilla 450',     cilindrada: 450, precio: 174900 },
  { nombre: 'Himalayan 450',     cilindrada: 450, precio: 179900 },
  { nombre: 'Classic 650',       cilindrada: 650, precio: 219900 },
  { nombre: 'Super Meteor 650',  cilindrada: 650, precio: 249900 },
  { nombre: 'Shotgun 650',       cilindrada: 650, precio: 259900 },
  { nombre: 'Interceptor 650',   cilindrada: 650, precio: 199900 },
  { nombre: 'Continental GT 650', cilindrada: 650, precio: 229900 },
];

// Precio indicativo por cilindrada (fallback si el quote no trae precio).
const PRECIO_DEFAULT = { 350: 114900, 450: 179900, 650: 229900 };

/**
 * SKUs REALES de GLG por cilindrada — fuente de verdad para el match embebido.
 * Al cotizar en Prolibu se lee el SKU del producto y se ubica su cilindrada aquí.
 */
const SKUS_350 = [
  'pl-2026_meteor-aurora-blue', 'pl-2026_meteor-aurora-black', 'pl-2026_meteor-stellar-blue',
  'pl-2026_meteor-stellar-black', 'pl-2026_meteor-fireball-black', 'pl-2026_hunter-rebel-red',
  'pl-2026_hunter-rebel-blue', 'pl-2026_hunter-dapper-green', 'pl-2026_hunter-dapper-grey',
  'pl-2026_classic-stealth-black', 'pl-2026_classic-emerald-green', 'pl-2026_classic-commando-sand',
  'pl-2025_meteor-supernova-blue', 'pl-2025_meteor-aurora-green', 'pl-2025_meteor-aurora-blue',
  'pl-2025_meteor-aurora-black', 'pl-2025_meteor-stellar-red', 'pl-2025_meteor-stellar-blue',
  'pl-2025_meteor-stellar-black', 'pl-2025_meteor-fireball-matt-green', 'pl-2025_meteor-fireball-black',
  'pl-2025_meteor-fireball-blue', 'pl-2025_hunter-rebel-red', 'pl-2025_hunter-rebel-blue',
  'pl-2025_hunter-dapper-orange', 'pl-2025_hunter-dapper-green', 'pl-2025_hunter-dapper-grey',
  'pl-2025_classic-dark-stealth-black', 'pl-2025_classic-dark-gunmetal-grey', 'pl-2025_classic-chrome-red',
  'pl-2025_classic-emerald-green', 'pl-2025_classic-chrome-bronze', 'pl-2025_classic-signals-marsh-grey',
  'pl-2025_classic-signals-desert-sand', 'pl-2025_classic-halcyon-green', 'pl-2025_classic-halcyon-black',
];
const SKUS_450 = [
  'pl-2026_grr-450-yellow-ribbon', 'pl-2026_grr-450-brava-blue', 'pl-2026_grr-450-gold-dip',
  'pl-2026_grr-450-peix-bronze', 'pl-2026_grr-450-playa-black', 'pl-2026_grr-450-smoke-silver',
  'pl-2026_grr-450-smoke-silver-análogo', 'pl-2026_himalayan-hanle-black', 'pl-2026_himalayan-kamet-white',
  'pl-2026_himalayan-slate-poppy-blue', 'pl-2025_grr-450-yellow-ribbon', 'pl-2025_grr-450-brava-blue',
  'pl-2025_grr-450-gold-dip', 'pl-2025_grr-450-playa-black', 'pl-2025_grr-450-smoke-silver',
  'pl-2025_grr-450-smoke-silver-análogo', 'pl-2025_himalayan-hanle-black', 'pl-2025_himalayan-kamet-white',
  'pl-2025_himalayan-slate-poppy-blue', 'pl-2025_himalayan-slate-himalayan-salt',
];
const SKUS_650 = [
  'pl-2026_classic-650-twin-black-chrome', 'pl-2026_classic-650-twin-vallam-red',
  'pl-2026_classic-650-twin-bruntingthorpe-blue', 'pl-2026_super-meteor-celestial-red',
  'pl-2026_super-meteor-celestial-blue', 'pl-2026_super-meteor-astral-black', 'pl-2026_shotgun-sheet-metal-grey',
  'pl-2026_int-bear-white-249', 'pl-2026_int-bear-gldn-shdw-black', 'pl-2026_int-bear-petrol-green',
  'pl-2026_int-bear-wildhoney-yellow', 'pl-2026_int-bear-boardwalk-white', 'pl-2026_int-barcelona-blue',
  'pl-2026_int-cali-green', 'pl-2026_continental-gt-mr-clean', 'pl-2026_continental-gt-rocker-red',
  'pl-2025_super-meteor-celestial-red', 'pl-2025_super-meteor-celestial-blue', 'pl-2025_super-meteor-interstellar-green',
  'pl-2025_super-meteor-astral-green', 'pl-2025_super-meteor-astral-blue', 'pl-2025_super-meteor-astral-black',
  'pl-2025_shotgun-stencil-white', 'pl-2025_shotgun-sheet-metal-grey', 'pl-2025_shotgun-green-drill',
  'pl-2025_int-bear-white-249', 'pl-2025_int-bear-gldn-shdw-black', 'pl-2025_int-bear-petrol-green',
  'pl-2025_int-bear-wildhoney-yellow', 'pl-2025_int-bear-boardwak-white', 'pl-2025_int-sunset-strip',
  'pl-2025_int-black-ray', 'pl-2025_int-barcelona-blue', 'pl-2025_int-canyon-red', 'pl-2025_int-cali-green',
  'pl-2025_continental-gt-mr-clean', 'pl-2025_continental-gt-slipstream-blue', 'pl-2025_continental-gt-apex-grey',
  'pl-2025_continental-gt-rocker-red', 'pl-2025_continental-gt-dux-deluxe', 'pl-2025_continental-gt-british-racing-green',
];

const SKU_CILINDRADA = {};
SKUS_350.forEach(s => { SKU_CILINDRADA[s.toLowerCase()] = 350; });
SKUS_450.forEach(s => { SKU_CILINDRADA[s.toLowerCase()] = 450; });
SKUS_650.forEach(s => { SKU_CILINDRADA[s.toLowerCase()] = 650; });

// Deriva un nombre legible desde el SKU: pl-2026_meteor-aurora-blue -> "Meteor Aurora Blue (2026)"
function derivarNombre(sku) {
  const m = /^pl-(\d{4})[_-](.+)$/i.exec(sku || '');
  if (!m) return sku || 'Vehículo';
  const nombre = m[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `${nombre} (${m[1]})`;
}

/**
 * Ubica el vehículo cotizado por SKU (exacto) o, como respaldo, por nombre de producto.
 * Devuelve { sku, cilindrada, nombre, precio }.
 */
function findModeloBySku(sku, productName) {
  if (sku) {
    const cil = SKU_CILINDRADA[String(sku).trim().toLowerCase()];
    if (cil) return { sku, cilindrada: cil, nombre: derivarNombre(sku), precio: PRECIO_DEFAULT[cil] };
  }
  if (productName) {
    const p = String(productName).trim().toLowerCase();
    const fam = MODELOS.find(m => p.includes(m.nombre.toLowerCase()) || p.includes(m.nombre.toLowerCase().split(' ')[0]));
    if (fam) return { sku, cilindrada: fam.cilindrada, nombre: productName, precio: fam.precio };
  }
  return null;
}
