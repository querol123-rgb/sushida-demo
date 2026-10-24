# Sushida Malahide · Web

Web completa para Sushida Malahide: inicio, carta online, carrito, pedidos a domicilio / recogida con cuenta de cliente, seguimiento del pedido, reservas de mesa y panel de cocina (admin).

Sin dependencias: solo necesita **Node.js 22.13 o superior** (usa SQLite integrado en Node).

## Arrancar

```bash
cd sushida-malahide
npm start
```

Abre http://localhost:3000

La primera vez se crea una cuenta de administrador y su contraseña se guarda en `data/ADMIN_CREDENTIALS.txt`. Entra con ella y ve a **Admin** (o `#/admin`). Apunta la contraseña y borra ese archivo.

## Qué editar

| Qué | Dónde |
|---|---|
| Platos, precios, descripciones, etiquetas (popular, veg, spicy, gf, new) | `data/menu.json` (se recarga sola, sin reiniciar) |
| Zonas de reparto (prefijos Eircode), coste de envío, envío gratis, pedido mínimo, tiempos | `config.json` |
| Horario de apertura | `config.json` → `openHour` / `closeHour` |
| Textos, reseñas, fotos de la página de inicio | `public/app.js` → `viewHome` |
| Colores y tipografías | `public/styles.css` → `:root` |

> ⚠️ La carta incluida es **de ejemplo**: hay que sustituirla por la carta y precios reales del restaurante.

## Funciones

- **Clientes**: registro / login (contraseñas con scrypt, sesiones HttpOnly de 30 días), perfil con dirección guardada, historial de pedidos, "Reordenar", seguimiento en directo del estado.
- **Pedidos**: delivery (solo Eircodes permitidos, pedido mínimo, envío gratis a partir de X €) o recogida; ASAP o programado para más tarde; pago en efectivo o tarjeta a la entrega; notas/alergias; palillos sí/no. Los precios se recalculan siempre en el servidor.
- **Reservas**: formulario con la regla de "reservas del mismo día hasta las 14:00".
- **Admin**: pedidos en tiempo real (se refresca cada 15 s y avisa de pedidos nuevos), cambio de estado (recibido → preparando → en reparto/listo → completado), estadísticas del día, gestión de reservas.

## Para ponerla en internet (siguiente paso)

1. Hosting con Node (Render, Railway, Fly.io o un VPS) con disco persistente para `data/`.
2. HTTPS delante (el servidor marca la cookie como `Secure` cuando recibe `X-Forwarded-proto: https`).
3. Pagos online con tarjeta: integrar Stripe Checkout en `POST /api/orders`.
4. Emails de confirmación de pedido/reserva (p. ej. Resend o SendGrid).
