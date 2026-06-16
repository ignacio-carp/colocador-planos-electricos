/** Presentation helpers for jobs list / DXF metadata (US-004 / US-006). */

export function formatJobCreatedAt(iso: string | undefined): string | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('es', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function formatJobModifiedLabel(iso: string | undefined): string | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(d)
    .toUpperCase()
}

export function hasRegisteredDxfInput(files: readonly { kind: string }[]): boolean {
  return files.some((f) => f.kind === 'input_dxf')
}

/** @deprecated Use hasRegisteredDxfInput */
export const hasRegisteredDwgInput = hasRegisteredDxfInput

export type ProjectStatusChip = {
  label: string
  className: string
}

/** Map API job status to design system project chips. */
export function projectStatusChip(status?: string): ProjectStatusChip {
  const s = (status ?? 'pending').toLowerCase()
  if (s === 'completed' || s === 'procesado') {
    return {
      label: 'Completado',
      className: 'bg-success/10 text-success',
    }
  }
  if (s === 'processing' || s === 'procesando') {
    return {
      label: 'En revisión',
      className: 'bg-secondary-container/80 text-on-secondary-container',
    }
  }
  if (s === 'analizando') {
    return {
      label: 'Analizando…',
      className: 'bg-secondary-container/80 text-on-secondary-container',
    }
  }
  if (s === 'listo_para_editar') {
    return {
      label: 'Listo para editar',
      className: 'bg-success/10 text-success',
    }
  }
  if (s === 'parcialmente_procesado') {
    return {
      label: 'En proceso',
      className: 'bg-secondary-container/80 text-on-secondary-container',
    }
  }
  if (s === 'failed' || s === 'error') {
    return {
      label: 'Error',
      className: 'bg-error-container text-on-error-container',
    }
  }
  return {
    label: 'Activo',
    className: 'bg-success/10 text-success',
  }
}

export type FileRowStatus = {
  label: string
  className: string
  showProgress?: boolean
  progressPct?: number
  downloadEnabled: boolean
}

export function fileRowStatus(jobStatus?: string, hasInput?: boolean): FileRowStatus {
  const s = (jobStatus ?? '').toLowerCase()
  if (s === 'completed' || s === 'procesado') {
    return {
      label: 'Listo',
      className: 'bg-success/10 text-success',
      downloadEnabled: true,
    }
  }
  if (s === 'processing' || s === 'procesando') {
    return {
      label: 'Procesando…',
      className: 'bg-secondary-container text-on-secondary-container',
      showProgress: true,
      progressPct: 65,
      downloadEnabled: false,
    }
  }
  if (s === 'analizando') {
    return {
      label: 'Analizando…',
      className: 'bg-secondary-container text-on-secondary-container',
      showProgress: true,
      progressPct: 45,
      downloadEnabled: false,
    }
  }
  if (s === 'listo_para_editar') {
    return {
      label: 'Listo para editar',
      className: 'bg-success/10 text-success',
      downloadEnabled: false,
    }
  }
  if (s === 'parcialmente_procesado') {
    return {
      label: 'En proceso',
      className: 'bg-secondary-container/80 text-on-secondary-container',
      downloadEnabled: true,
    }
  }
  if (hasInput) {
    return {
      label: 'Pendiente',
      className: 'bg-surface-container text-on-surface-variant',
      downloadEnabled: false,
    }
  }
  return {
    label: 'Sin archivo',
    className: 'bg-surface-container-high text-outline',
    downloadEnabled: false,
  }
}

/** Align with API `jobsStore` JobStatus plus legacy/Spanish labels. */
export function canDownloadProcessedDxf(status?: string): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'completed' || s === 'procesado' || s === 'parcialmente_procesado'
}

/** Returns true when the job has completed preliminary analysis and workspace is available. */
export function isReadyForWorkspace(status?: string): boolean {
  const s = (status ?? '').toLowerCase()
  return (
    s === 'listo_para_editar' ||
    s === 'parcialmente_procesado' ||
    s === 'procesado'
  )
}

/** Returns true when room processing botonera is available (US-013). */
export function isRoomProcessingAvailable(status?: string): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'listo_para_editar' || s === 'parcialmente_procesado'
}

/** Returns true when preliminary analysis is in progress (disable editing). */
export function isAnalyzing(status?: string): boolean {
  return (status ?? '').toLowerCase() === 'analizando'
}

/** Background refresh interval while IA analyzes the DXF (avoid UI flicker). */
export const JOB_ANALYSIS_POLL_MS = 60_000

/** Faster refresh while individual rooms are being processed. */
export const ROOM_PROCESSING_POLL_MS = 5_000

/** @deprecated Use canDownloadProcessedDxf */
export const canDownloadProcessedDwg = canDownloadProcessedDxf
