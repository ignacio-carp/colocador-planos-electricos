import React, { useState } from 'react'
import { Icon } from './Icon'
import WorkspaceChatPanel from './WorkspaceChatPanel'

type Props = {
  jobId: string
  apiBase: string
  accessToken: string
  captureView?: (() => string | null) | null
  canSend: boolean
  onWorkspaceMutated?: () => void
}

/**
 * US-014 — Chat minimizable flotante en la parte inferior del workspace.
 */
export default function FloatingWorkspaceChat({
  jobId,
  apiBase,
  accessToken,
  captureView,
  canSend,
  onWorkspaceMutated,
}: Props) {
  const [minimized, setMinimized] = useState(true)

  if (minimized) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-5 py-3 shadow-lg transition hover:border-primary hover:shadow-xl"
        >
          <Icon name="smart_toy" className="text-[22px] text-primary" />
          <span className="text-body-sm font-semibold text-on-surface">Asistente eléctrico</span>
          <Icon name="expand_less" className="text-[20px] text-on-surface-variant" />
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg shadow-2xl">
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="flex items-center gap-1 rounded-full bg-surface-container-highest px-3 py-1.5 text-technical-label text-on-surface-variant shadow hover:bg-surface-container-high"
            aria-label="Minimizar chat"
          >
            <Icon name="expand_more" className="text-[18px]" />
            Minimizar
          </button>
        </div>
        <WorkspaceChatPanel
          jobId={jobId}
          apiBase={apiBase}
          accessToken={accessToken}
          captureView={captureView}
          canSend={canSend}
          onWorkspaceMutated={onWorkspaceMutated}
        />
      </div>
    </div>
  )
}
