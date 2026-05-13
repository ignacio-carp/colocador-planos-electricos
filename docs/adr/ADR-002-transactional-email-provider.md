# ADR-002: Proveedor de email transaccional (invitaciones)

## Estado

Propuesta / MVP — criterios de negocio finales **TBD**; implementación actual cubre integración y plantilla US-001.

## Contexto

US-001 requiere envío de correo con enlace de invitación (token). Opciones habituales: **Resend**, **SendGrid**, **Amazon SES**.

## Decisión (MVP)

- **Proveedor integrado:** [Resend](https://resend.com/) vía API HTTP oficial (`resend` npm).
- **Motivos:** API mínima, buen DX en Node, dominio de prueba `onboarding@resend.dev` para smoke sin DNS propio; coste y límites acordes a MVP.
- **Alternativas no descartadas:** SendGrid (ecosistema amplio), SES (coste bajo a escala, más operación AWS). Cambiar proveedor implica sustituir el adaptador en `apps/api/src/email/` y variables de entorno; la plantilla y el flujo de invitación permanecen.

## Política ante fallo de envío (TBD detalle negocio)

| Aspecto | MVP actual | Seguimiento sugerido |
|--------|------------|----------------------|
| Reintento | No hay cola asíncrona; el POST devuelve error al administrador. | Cola (p. ej. worker + tabla `outbox`) o reintento exponencial. |
| Visibilidad admin | Mensaje HTTP + cuerpo JSON con código (`EMAIL_SEND_FAILED`). | Pantalla de historial / estados de invitación en admin. |
| Ticket hijo | — | Definir con producto umbrales y UX de reintento manual. |

## Rate limit (creación de invitaciones)

Umbrales **TBD** con negocio. Valores por defecto configurables por entorno:

- `INVITE_RATE_LIMIT_WINDOW_MS` (default: 1 h).
- `INVITE_RATE_LIMIT_MAX` (default: 30 invitaciones por ventana por usuario administrador autenticado).

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `RESEND_API_KEY` | API key Resend; si falta, el envío falla con error explícito (no se simula éxito en producción). |
| `EMAIL_FROM` | Remitente; en pruebas Resend sin dominio verificado usar `onboarding@resend.dev`. |
| `PUBLIC_WEB_URL` | Base del front para el enlace del correo (sin barra final). |

## Consecuencias

- Staging/producción requieren `RESEND_API_KEY` y remitente válido para cumplir “correo recibido”.
- El enlace apunta a `PUBLIC_WEB_URL/invite?token=…` (verificación mínima del token vía API pública).
