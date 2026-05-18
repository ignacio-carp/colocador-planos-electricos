import { Resend } from 'resend'
import {
  buildInvitationHtml,
  buildInvitationSubject,
  buildInvitationText,
  type InvitationTemplateVars,
} from './buildInvitationContent'

export type SendInvitationResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; code: 'MISSING_API_KEY' | 'MISSING_FROM' | 'SEND_FAILED'; detail?: string }

function getFromAddress(): string | undefined {
  const from = process.env.EMAIL_FROM?.trim()
  return from || undefined
}

export async function sendInvitationEmail(params: {
  to: string
  inviteUrl: string
  inviterDisplay: string
}): Promise<SendInvitationResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, code: 'MISSING_API_KEY' }
  }
  const from = getFromAddress()
  if (!from) {
    return { ok: false, code: 'MISSING_FROM' }
  }

  const templateVars: InvitationTemplateVars = {
    inviteUrl: params.inviteUrl,
    inviterDisplay: params.inviterDisplay,
  }

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: params.to,
    subject: buildInvitationSubject(),
    text: buildInvitationText(templateVars),
    html: buildInvitationHtml(templateVars),
  })

  if (error) {
    return { ok: false, code: 'SEND_FAILED', detail: error.message }
  }

  return { ok: true, providerMessageId: data?.id }
}
