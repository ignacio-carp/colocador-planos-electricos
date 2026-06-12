/**
 * US-014 — chat message persistence per job.
 * Supabase table public.job_chat_messages; in-memory fallback when storage
 * is not configured (tests / local dev without Supabase).
 */

import { randomUUID } from 'node:crypto'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type ChatRole = 'user' | 'assistant' | 'system'
export type ChatIntent = 'query' | 'edit' | 'action'

export type ChatMessage = {
  id: string
  job_id: string
  user_id: string | null
  role: ChatRole
  content: string
  intent?: ChatIntent
  actions_taken?: Record<string, unknown>
  created_at: string
}

const memoryMessages: ChatMessage[] = []

function useMemoryStore(): boolean {
  if (process.env.JOBS_USE_MEMORY === '1') return true
  return !isStorageConfigured()
}

export type AppendChatMessageInput = {
  jobId: string
  userId?: string | null
  role: ChatRole
  content: string
  intent?: ChatIntent
  actionsTaken?: Record<string, unknown>
}

export async function appendChatMessage(input: AppendChatMessageInput): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: randomUUID(),
    job_id: input.jobId,
    user_id: input.userId ?? null,
    role: input.role,
    content: input.content,
    intent: input.intent,
    actions_taken: input.actionsTaken,
    created_at: new Date().toISOString(),
  }
  if (useMemoryStore()) {
    memoryMessages.push(message)
    return message
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('job_chat_messages')
    .insert({
      id: message.id,
      job_id: message.job_id,
      user_id: message.user_id,
      role: message.role,
      content: message.content,
      intent: message.intent ?? null,
      actions_taken: message.actions_taken ?? null,
    })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'insert chat message failed')
  return rowToMessage(data as Record<string, unknown>) ?? message
}

export async function listChatMessages(jobId: string, limit = 100): Promise<ChatMessage[]> {
  if (useMemoryStore()) {
    return memoryMessages.filter((m) => m.job_id === jobId).slice(-limit)
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('job_chat_messages')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => rowToMessage(row as Record<string, unknown>))
    .filter((m): m is ChatMessage => m !== null)
}

function rowToMessage(row: Record<string, unknown>): ChatMessage | null {
  const role = row.role
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null
  const intentRaw = row.intent
  const intent =
    intentRaw === 'query' || intentRaw === 'edit' || intentRaw === 'action'
      ? intentRaw
      : undefined
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    user_id: row.user_id ? String(row.user_id) : null,
    role,
    content: String(row.content ?? ''),
    intent,
    actions_taken:
      row.actions_taken && typeof row.actions_taken === 'object' && !Array.isArray(row.actions_taken)
        ? (row.actions_taken as Record<string, unknown>)
        : undefined,
    created_at: new Date(String(row.created_at ?? new Date().toISOString())).toISOString(),
  }
}

/** Test helper — reset in-memory store. */
export function clearChatMessagesForTests(): void {
  memoryMessages.length = 0
}
