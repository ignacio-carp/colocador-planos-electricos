import WebSocket from 'ws'

// Supabase Realtime on Node 20 needs an explicit WebSocket implementation.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket as typeof globalThis.WebSocket
}
