# Pruebas de punta a punta

```bash
cd e2e
npm install
npx playwright install chromium   # solo la primera vez

npm test                 # contra http://localhost:5173 (necesita pnpm dev)
npm run test:prod        # contra https://steward.e-ministry.online
npm run test:escritura   # crea órdenes reales en el sandbox de PayPal
npm run test:headed      # con navegador visible
npm run report           # abre el último informe
```

## Qué cubren y qué no

**Sí cubren:** la pantalla de entrada y las tres personas demo, iniciar sesión
sin contraseña, cambiar de rol, el idioma EN/ES, que la API rechace registrar
una ofrenda sin sesión, que el botón de PayPal quede listo (varias recargas
seguidas, porque ese fallo fue intermitente), el recibo con su desglose de
comisión y neto, y que `/health` responda sano.

**No cubren el pago completo.** Terminar una captura exige iniciar sesión con
una cuenta de comprador del sandbox de PayPal, y no automatizamos
credenciales. Las pruebas de escritura llegan hasta que el checkout de PayPal
toma el control; de ahí en adelante se prueba a mano.
