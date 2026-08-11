# Guía de consumo de API —  (cotizacion / cotizador)

## 1. Base URL y autenticación

```js
const HOST = window.__PROLIBU_CONFIG__.domain;      // ej: christus.prolibu.com
const API_BASE = `https://${HOST}/v2`;
const apiKey = localStorage.getItem('apiKey');       // obtenido en /v2/auth/signin

fetch(`${API_BASE}${path}`, {
  ...opts,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...opts.headers
  }
});
```

---

## 2. Endpoints, uno por uno

**`GET /v2/contact/search?limit=8&term=<texto>`** — autocompletar cliente por nombre/email/teléfono.
```js
const res = await api(`/contact/search?limit=8&term=${encodeURIComponent(term)}`);
const { data } = await res.json(); // array de contactos
```

**`POST /v2/contact/`** — crear cliente si no existe.
```js
const body = {
  firstName, lastName, email,
  mobile: '+52 5512345678',
  identification: { docType: 'INE', docId: '...' } // opcional
};
const res = await api('/contact/', { method: 'POST', body: JSON.stringify(body) });
const contact = await res.json(); // contact._id
```

**`GET /v2/contact/<id>`** — recuperar un contacto por id (al cargar un Deal existente).

**`GET /v2/pricebookentry/search?limit=15&term=<texto>`** — buscar el modelo de moto en el catálogo de precios.
```js
const res = await api(`/pricebookentry/search?limit=15&term=${encodeURIComponent(term)}`);
const { data } = await res.json(); // cada item trae .product.productName / .product.productCode
```

**`GET /v2/pricebookentry?limit=25&populate=product`** — listar el catálogo completo (cuando el buscador está vacío).

**`GET /v2/quote/formatlineitem?pricebookEntryId=<pbeId>`** — obtener el precio real de un pricebookEntry (el search no lo trae).
```js
const li = await (await api(`/quote/formatlineitem?pricebookEntryId=${pbeId}`)).json();
// li.price / li.netUnitPrice / li.unitPrice, li.productName, li.productCode, li.specialNotes
```

**`GET /v2/deal/search?limit=10&term=<texto>`** y **`GET /v2/deal?contact=<id>&limit=5`** — buscar cotizaciones existentes por nombre o por contacto (para el modo "Editar").

**`GET /v2/deal/<id>`** — cargar un Deal completo.

```

**`POST /v2/deal/`** — crear la cotización.
```js
const payload = {
  dealName: title,
  contact: contactId,
  proposal: {
    enabled: true,
    title,
    quote: {
      quoteCurrency: 'MXN',
      lineItems: [{ ...lineItemDeFormatlineitem, quantity: 1, discountAmount: 0 }]
    }
  }
};
const deal = await (await api('/deal/', { method: 'POST', body: JSON.stringify(payload) })).json();
```

**`PATCH /v2/deal/<dealCode|dealId>`** — actualizar una cotización existente (mismo `payload`, sin `contact`).

**`POST /v2/shorturl/generate`** — acortar el link de la cotización para WhatsApp/correo.
```js
const r = await api('/shorturl/generate', { method: 'POST', body: JSON.stringify({ url: longUrl }) });
const { link } = await r.json();
```
---