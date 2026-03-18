# El Costo de la Ventana Perdida

Calculadora del costo incremental de la operación de deuda cancelada en febrero 2026.

## Stack

- React 18 + Vite
- Sin dependencias adicionales
- Datos en tiempo real: EMBI (Ambito Financiero) + US T10y (fiscaldata.treasury.gov)
- Fallback automático al último cierre conocido si los endpoints no responden

## Desarrollo local

```bash
npm install
npm run dev
```

## Deploy en Vercel

1. Subir este repositorio a GitHub
2. Ir a [vercel.com](https://vercel.com) → "Add New Project"
3. Importar el repo → Vercel detecta Vite automáticamente
4. Click en "Deploy" — sin configuración adicional

## Deploy en Netlify

1. Subir este repositorio a GitHub
2. Ir a [netlify.com](https://netlify.com) → "Add new site" → "Import from Git"
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Click en "Deploy"

## Actualizar fallbacks

Si el mercado se mueve mucho, actualizar en `src/App.jsx`:

```js
const FALLBACK_EMBI   = 583;    // bps
const FALLBACK_EMBI_D = "09/03/2026";

const FALLBACK_T10Y   = 0.0424; // decimal (4.24%)
const FALLBACK_T10Y_D = "17/03/2026";
```
