export type InvitationTemplateVars = {
  inviteUrl: string
  /** Placeholder hasta definición negocio (nombre invitador). */
  inviterDisplay: string
}

export function buildInvitationSubject(): string {
  return 'Invitación a Cambre Planos de Luz'
}

export function buildInvitationText(vars: InvitationTemplateVars): string {
  return [
    `Hola,`,
    ``,
    `${vars.inviterDisplay} te ha invitado a unirte a la plataforma.`,
    ``,
    `Completa tu registro usando este enlace (válido por tiempo limitado):`,
    vars.inviteUrl,
    ``,
    `Si no esperabas este correo, puedes ignorarlo.`,
  ].join('\n')
}

export function buildInvitationHtml(vars: InvitationTemplateVars): string {
  const safeUrl = escapeHtml(vars.inviteUrl)
  const safeInviter = escapeHtml(vars.inviterDisplay)
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Invitación</title></head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;">
  <p>Hola,</p>
  <p><strong>${safeInviter}</strong> te ha invitado a unirte a la plataforma.</p>
  <p><a href="${safeUrl}" style="color:#0f172a;">Abrir invitación</a></p>
  <p style="font-size:0.875rem;color:#64748b;">Si el botón no funciona, copia y pega esta URL en tu navegador:<br/>${safeUrl}</p>
  <p style="font-size:0.875rem;color:#64748b;">Si no esperabas este correo, puedes ignorarlo.</p>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
