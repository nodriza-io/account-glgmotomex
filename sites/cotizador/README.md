# Cotizador de Financiamiento — GLG (Royal Enfield México)

Site estático embebible dentro de la propuesta (Deal) de Prolibu. El asesor
captura los datos del cliente, elige banco / modelo / enganche / plazo, ve la
cuota mensual calculada y guarda el resultado en la propuesta.

## Estructura

```
public/
├── index.html   Chrome GLG (switcher de bancos + datos del cliente) + punto de montaje
├── styles.css   Chrome GLG + 3 skins fieles (BBVA / Santander / Banregio)
├── data.js      ⭐ Matriz de bancos (tasas, seguros, CxA, plazos) + catálogo de modelos
├── engine.js    Motor de cálculo compartido (puro, sin DOM)
├── skins.js     Plantillas HTML de cada banco (ids uniformes f_* / o_*)
└── app.js       Orquestador: switcher, montaje de skin, modos, puente Prolibu
```

## Skins por banco (clon fiel)

Cada banco tiene su diseño real. Un **switcher** (pestañas en el chrome GLG) cambia el
skin completo y **conserva los valores** (modelo, precio, enganche, plazo), recalculando
al instante con las tasas del banco elegido.

- **BBVA** — dos columnas, título negro, inputs con línea, tarjeta gris "Tasas y costos". Navy `#072146`.
- **Santander** — rojo `#EC0000`, tarjeta con cuota destacada.
- **Banregio** — naranja `#FF6A00`, "Características" + "Pago de / Resumen".

> Los skins usan wordmarks en texto. Para clon 100% fiel, colocar los logos oficiales (SVG/PNG).

## Bancos incluidos (fuente: Excel GLG)

| Banco | CxA | Tasa | Enganche mín. | Plazos |
|-------|-----|------|---------------|--------|
| Santander | 3% | 17.99% fija | 20% | 12–60 |
| BBVA | 3% | 17.99% / 15.49% / 13.49% (según enganche) | 20% | 12–60 |
| Banregio | 2% | 12.75%–17.99% (según cc y enganche) | 10–15% | 12–48/60 |
| Crédito Go | — | *sin datos* | — | *deshabilitado* |

Las tasas, seguros y plazos se editan en **`public/data.js`**.

## Fórmula — Santander y Banregio (sistema francés)

```
enganche      = precio × enganche%
financiar     = precio − enganche
CxA           = financiar × cxa_banco
pago inicial  = enganche + CxA            (no se financia)
principal     = financiar + seguro + seguroVida
cuota mensual = principal × i / (1 − (1+i)^−n)   con i = tasaAnual/12, n = plazo
total a pagar = cuota × n + pago inicial
```

## Fórmula — BBVA (modelo propio del banco)

BBVA **no** usa la fórmula de arriba. Validado contra la cotización real
**No. 54288845** (Meteor 350, $107,990, 20%, 36m): reproduce el pago mensual y
el total con 0.03% de desviación. Vive en `engine.js → calcularBBVA`.

```
i             = tasaAnual / 360 × 30.4375   (actual/360; NO tasaAnual/12)
financiar     = precio − enganche
MTF           = financiar + seguroDaños + seguroVida   ("Monto Total a Financiar")
CxA           = MTF × cxa_banco × 1.16      (con IVA, de contado, no se financia)
pago inicial  = enganche + CxA

Tres créditos paralelos que se pagan juntos:
  base_auto   = PMT(i, plazo, financiar)
  base_daños  = PMT(i, 12, seguroDaños)     ← prima ANUAL, se renueva en m13/25/37
  base_vida   = PMT(i, plazo, seguroVida)

cuota_mes     = base_auto + base_daños + base_vida + 16% × intereses_del_mes
```

Consecuencias: la mensualidad **no es fija** (baja con los intereses, sube al
renovar el seguro), a 36 meses se pagan **3 primas de daños**, y el IVA se cobra
**solo sobre intereses**, nunca sobre capital.

No se replica el *pago irregular* de arranque (los días entre la disposición y
el primer corte): depende de la fecha real de disposición. En la cotización de
referencia son $655.57 sobre $162,751.88.

## ✅ Confirmado con GLG (jul 2026)

- Valores por moto/cilindrada según el Excel (tasas, seguros, CxA, plazos).
- Seguro de vida = **$1,800** (Santander), no $7,500.
- CxA por banco: Santander 3%, BBVA 3%, Banregio 2% → va en el pago inicial.
- Seguros: se financian dentro de la cuota.
- Crédito Go: deshabilitado (sin tabla todavía).

## Pendientes

1. **Catálogo de modelos:** `MODELOS` en `data.js` es provisional. GLG enviará la lista real (nombre + precio + cilindrada).
2. **Uso desde el Quote Editor:** el cotizador debe poder usarse embebido en el editor de cotización de la plataforma (integración vía `postMessage` — ya preparada en `app.js`, falta probar embebido).
3. **Escritura en la propuesta:** definir si `banco/tasa/enganche/plazo/cuota` van como custom fields del Deal (hoy se envían en `value.financiamiento`).

## Desarrollo

```bash
# Previsualización local rápida (solo calculadora): abrir public/index.html en el navegador.

# Con la plataforma (requiere API Key en profile.json):
node prolibu site dev  --domain glgmotomex.prolibu.com --prefix cotizador --watch
node prolibu site prod --domain glgmotomex.prolibu.com --prefix cotizador
```
