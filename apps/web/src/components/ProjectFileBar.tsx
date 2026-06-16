import React, { useRef } from 'react'
import { Icon } from './Icon'
import type { FileRowStatus } from '../lib/jobPresentation'

type Props = {
  jobTitle: string
  jobId: string
  hasInput: boolean
  canEdit: boolean
  rowStatus: FileRowStatus
  createdLabel?: string | null
  downloading: boolean
  uploadLabel: string | null
  downloadEnabled: boolean
  onDownload: () => void
  onFileSelected: (file: File, mode: 'upload' | 'replace') => void
}

export default function ProjectFileBar({
  jobTitle,
  jobId,
  hasInput,
  canEdit,
  rowStatus,
  createdLabel,
  downloading,
  uploadLabel,
  downloadEnabled,
  onDownload,
  onFileSelected,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingModeRef = useRef<'upload' | 'replace'>('upload')

  function openPicker(mode: 'upload' | 'replace') {
    pendingModeRef.current = mode
    fileRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    onFileSelected(file, pendingModeRef.current)
  }

  function handleDrop(e: React.DragEvent, mode: 'upload' | 'replace') {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) onFileSelected(file, mode)
  }

  const fileName = hasInput ? `${jobTitle.replace(/\s+/g, '_')}.dxf` : null

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <input
        ref={fileRef}
        type="file"
        accept=".dxf,application/dxf,application/octet-stream"
        className="hidden"
        onChange={handleChange}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low/30 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-high">
            <Icon name="description" className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-body-sm font-bold text-on-surface">
              {fileName ?? 'Sin archivo DXF'}
            </p>
            <p className="text-technical-label text-outline">
              JOB_{jobId.slice(0, 8).toUpperCase()}
              {createdLabel ? ` · ${createdLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-technical-label inline-flex items-center rounded-full px-3 py-1 ${rowStatus.className}`}
          >
            {rowStatus.label}
          </span>
          {rowStatus.showProgress ? (
            <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full bg-primary"
                style={{ width: `${rowStatus.progressPct ?? 0}%` }}
              />
            </div>
          ) : null}
          {downloadEnabled ? (
            <button
              type="button"
              disabled={downloading}
              className="btn-primary flex items-center gap-2 px-4 py-2"
              onClick={onDownload}
            >
              <Icon name="download" className="text-[18px]" />
              {downloading ? 'Descargando…' : 'Descargar .DXF'}
            </button>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, hasInput ? 'replace' : 'upload')}
        >
          <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
            <Icon name="cloud_upload" className="text-primary" />
            {hasInput
              ? 'Arrastrá un nuevo .dxf para reemplazar el plano activo.'
              : 'Arrastrá un .dxf o seleccioná un archivo para comenzar.'}
          </div>
          <div className="flex flex-wrap gap-2">
            {hasInput ? (
              <button
                type="button"
                className="btn-secondary-outline text-sm"
                disabled={Boolean(uploadLabel)}
                onClick={() => {
                  const ok = window.confirm(
                    'Reemplazar el plano reiniciará el análisis y se perderá el progreso de procesamiento por habitación. ¿Continuar?',
                  )
                  if (ok) openPicker('replace')
                }}
              >
                {uploadLabel ?? 'Reemplazar DXF'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={Boolean(uploadLabel)}
                onClick={() => openPicker('upload')}
              >
                {uploadLabel ?? 'Subir DXF'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
