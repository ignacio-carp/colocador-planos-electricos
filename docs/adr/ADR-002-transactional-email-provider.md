# ADR-002: Proveedor de email transaccional (invitaciones)

## Estado

Aceptado — invitaciones US-001 vía **Supabase Auth** (`inviteUserByEmail`).

## Contexto

US-001 requiere envío de correo con enlace de invitación. Opciones habituales: **Resend**, **SendGrid**, **Amazon SES**, o el **correo integrado de Supabase Auth**.

## Decisión (MVP)

- **Proveedor integrado:** [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) — `auth.admin.inviteUserByEmail`.
- **Motivos:** Sin cuenta ni API key externa para el MVP; un solo proveedor (Supabase) para BD, Auth y correo de invitación; plantilla `invite` configurable en el dashboard; redirect al front (`PUBLIC_WEB_URL/invite`).
- **Implementación:** `apps/api/src/email/sendSupabaseInvitation.ts`; rol `architect` en `app_metadata` tras invitar; onboarding en `/invite` → `/invite/set-password` → `/invite/profile` y `POST /api/invites/complete`.
- **Alternativa descartada para MVP:** Resend (ADR anterior). Reintroducir un proveedor externo solo si Supabase SMTP no cubre volumen o deliverability en producción.

## Política ante fallo de envío

| Aspecto | MVP actual | Seguimiento sugerido |
|--------|------------|----------------------|
| Reintento | No hay cola; el POST devuelve error al administrador. | Cola o reintento manual. |
| Visibilidad admin | Mensaje HTTP + código (`INVITE_SEND_FAILED`). | Historial de invitaciones en admin. |
| Configuración | Revisar **Authentication → Email** y **URL Configuration** en Supabase. | SMTP custom en Supabase si hace falta. |

## Rate limit (creación de invitaciones)

- `INVITE_RATE_LIMIT_WINDOW_MS` (default: 1 h).
- `INVITE_RATE_LIMIT_MAX` (default: 30 invitaciones por ventana por administrador).

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | API admin para invitar y asignar rol. |
| `PUBLIC_WEB_URL` | Base del front; redirect del correo → `/invite`. |

## Configuración Supabase (dashboard)

1. **Authentication → URL Configuration:** Site URL y **Redirect URLs** deben incluir `PUBLIC_WEB_URL` y `PUBLIC_WEB_URL/invite`.
2. **Authentication → Email Templates:** plantilla **Invite** (asunto y cuerpo).
3. **Authentication → SMTP Settings** (opcional en dev; recomendado en producción para deliverability).

## Consecuencias

- No se requieren `RESEND_API_KEY` ni `EMAIL_FROM` en la API.
- El arquitecto recibe el correo de Supabase, define contraseña en `/invite/set-password`, completa el perfil en `/invite/profile` y accede con rol `architect`.
- Invitaciones legacy con `?token=` en la URL siguen soportadas temporalmente vía `POST /api/invites/accept`.
