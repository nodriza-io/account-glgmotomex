# Cotización — GLG (Site 1)

Site con **login** para que el asesor cree una cotización de punta a punta:

1. **Login** (`POST /v2/auth/signin`) → guarda apiKey.
2. **Buscar/crear contacto** (`GET /v2/contact/{email}`, `POST /v2/contact/`).
3. **Título** de la propuesta.
4. **Seleccionar producto** (`GET /v2/product/search`) → fija cilindrada por SKU.
5. **Calculadora 3 bancos** (reusa `calculator.js` + `skins.js` + `data.js` + `engine.js`).
6. **Crear el Deal** (`POST /v2/deal/`) con `proposal.quote.lineItems` + custom fields de financiamiento.

## Relación con el Site 2

| Site 1 (`cotizacion`) | Site 2 (`cotizador`) |
|---|---|
| Formulario con login, crea el Deal | Calculadora embebida en la propuesta |
| Usa la calculadora completa | Lee el SKU cotizado (informativa) |

Ambos comparten `data.js`, `engine.js`, `skins.js`, `calculator.js`, `styles.css`.

## Custom fields (modelo Deal)

Guarda: `finBanco`, `finTasaAnual`, `finEnganchePct`, `finEnganche`, `finPlazoMeses`,
`finComisionApertura`, `finSeguro`, `finSeguroVida`, `finPagoInicial`, `finCuotaMensual`, `finImporteTotal`.
Se crean con `./prolibu customfield push` (ver carpeta `objects/CustomField/Deal.json`).

## Desarrollo

```bash
node prolibu site dev  --domain glgmotomex.prolibu.com --prefix cotizacion --watch --port 3031
node prolibu site prod --domain glgmotomex.prolibu.com --prefix cotizacion
```

> ⚠️ Endpoints de `product/search` y creación de `contact`/`deal` pueden requerir ajuste
> de parámetros tras probar contra la API real.
