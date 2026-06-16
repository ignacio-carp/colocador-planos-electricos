import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CadViewer, type CadViewerRef } from '@cadview/react'
import type { ViewTransform } from '@cadview/core'
import DxfLayerPanel, { type LayerSuggestions } from './DxfLayerPanel'
import { buildInitialLayerVisibility, isElectricalLayerName } from './dxfLayerUtils'
import ElectricalSvgOverlay from './ElectricalSvgOverlay'
import { normalizeElectricalElements, normalizeRenderData } from './normalizeRenderData'
import type { RenderData } from './PlanViewer2D'
import RoomSvgOverlay from './RoomSvgOverlay'

type Props = {
  jobId: string
  apiBase: string
  accessToken: string
  layerSuggestions?: LayerSuggestions | null
  renderData?: RenderData | null
  selectedRoomId?: string | null
  onRoomClick?: (roomId: string) => void
  /**
   * Receives a function that captures the current rendered view as a PNG data
   * URL (chat screenshot reference). Called with null on unmount.
   */
  onCaptureReady?: (capture: (() => string | null) | null) => void
  /** Re-fetches the DXF stream when this value changes (e.g. after chat edits). */
  reloadToken?: number
}

export default function DxfWorkspaceViewer({
  jobId,
  apiBase,
  accessToken,
  layerSuggestions,
  renderData,
  selectedRoomId,
  onRoomClick,
  onCaptureReady,
  reloadToken,
}: Props) {
  const viewerRef = useRef<CadViewerRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dxfBuffer, setDxfBuffer] = useState<ArrayBuffer | null>(null)
  const [dxfKind, setDxfKind] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({})
  const [cadLayerNames, setCadLayerNames] = useState<string[]>([])
  const [showRoomOverlay, setShowRoomOverlay] = useState(true)
  const [showElectricalOverlay, setShowElectricalOverlay] = useState(true)
  const [viewTransform, setViewTransform] = useState<ViewTransform | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  const normalizedRooms = useMemo(() => {
    if (!renderData) return []
    return normalizeRenderData(renderData).rooms
  }, [renderData])

  const electricalElements = useMemo(
    () => normalizeElectricalElements(renderData?.electrical_elements),
    [renderData],
  )

  const fetchDxf = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/dxf-stream`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setDxfKind(res.headers.get('X-Dxf-Kind'))
      setDxfBuffer(await res.arrayBuffer())
    } catch (e) {
      setDxfBuffer(null)
      setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el DXF')
    } finally {
      setLoading(false)
    }
  }, [apiBase, jobId, accessToken])

  useEffect(() => {
    void fetchDxf()
  }, [fetchDxf, reloadToken])

  // Expose a capture function: the viewer canvas as a PNG data URL.
  useEffect(() => {
    if (!onCaptureReady) return
    const capture = (): string | null => {
      const canvas = containerRef.current?.querySelector('canvas')
      if (!canvas) return null
      try {
        return canvas.toDataURL('image/png')
      } catch {
        return null
      }
    }
    onCaptureReady(capture)
    return () => onCaptureReady(null)
  }, [onCaptureReady])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setCanvasSize({ width: rect.width, height: rect.height })
      viewerRef.current?.getViewer()?.resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const applyLayerVisibility = useCallback((visibility: Record<string, boolean>) => {
    const viewer = viewerRef.current
    if (!viewer) return
    for (const [name, visible] of Object.entries(visibility)) {
      viewer.setLayerVisible(name, visible)
    }
  }, [])

  const handleLayersLoaded = useCallback(
    (layers: { name: string }[]) => {
      const names = layers.map((l) => l.name)
      setCadLayerNames(names)
      const initial = buildInitialLayerVisibility(names, layerSuggestions ?? undefined)
      setLayerVisibility(initial)
      applyLayerVisibility(initial)
      viewerRef.current?.fitToView()
    },
    [layerSuggestions, applyLayerVisibility],
  )

  const layerPanelState = useMemo(
    () =>
      cadLayerNames.map((name) => ({
        name,
        visible: layerVisibility[name] ?? true,
        suggested: Boolean(layerSuggestions?.suggested_visible.includes(name)),
        electrical: isElectricalLayerName(name),
      })),
    [cadLayerNames, layerVisibility, layerSuggestions],
  )

  const toggleLayer = useCallback(
    (name: string, visible: boolean) => {
      setLayerVisibility((prev) => {
        const next = { ...prev, [name]: visible }
        viewerRef.current?.setLayerVisible(name, visible)
        return next
      })
    },
    [],
  )

  const showSuggested = useCallback(() => {
    const next = buildInitialLayerVisibility(cadLayerNames, layerSuggestions ?? undefined)
    setLayerVisibility(next)
    applyLayerVisibility(next)
  }, [cadLayerNames, layerSuggestions, applyLayerVisibility])

  const showAll = useCallback(() => {
    const next = Object.fromEntries(cadLayerNames.map((n) => [n, true]))
    setLayerVisibility(next)
    applyLayerVisibility(next)
  }, [cadLayerNames, applyLayerVisibility])

  const hideAll = useCallback(() => {
    const next = Object.fromEntries(cadLayerNames.map((n) => [n, false]))
    setLayerVisibility(next)
    applyLayerVisibility(next)
  }, [cadLayerNames, applyLayerVisibility])

  if (loading) {
    return (
      <div className="flex h-[min(72vh,720px)] min-h-[480px] items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex items-center gap-3 text-body-sm text-on-surface-variant">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Cargando plano DXF…
        </div>
      </div>
    )
  }

  if (loadError || !dxfBuffer) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
        <p className="text-body-sm text-on-surface-variant">
          {loadError ?? 'DXF no disponible'}
        </p>
        <button type="button" className="btn-secondary-outline text-sm" onClick={() => void fetchDxf()}>
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-[#1a1a1a]">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <span className="rounded bg-surface-container-highest/90 px-2 py-1 text-technical-label text-on-surface-variant backdrop-blur-sm">
            {dxfKind === 'output_dxf' ? 'DXF procesado' : 'DXF original'}
          </span>
          {normalizedRooms.length > 0 ? (
            <label className="flex items-center gap-2 rounded bg-surface-container-highest/90 px-2 py-1 text-technical-label text-on-surface-variant backdrop-blur-sm">
              <input
                type="checkbox"
                checked={showRoomOverlay}
                onChange={(e) => setShowRoomOverlay(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Habitaciones IA
            </label>
          ) : null}
          {electricalElements.length > 0 ? (
            <label className="flex items-center gap-2 rounded bg-surface-container-highest/90 px-2 py-1 text-technical-label text-on-surface-variant backdrop-blur-sm">
              <input
                type="checkbox"
                checked={showElectricalOverlay}
                onChange={(e) => setShowElectricalOverlay(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Eléctrico ({electricalElements.length})
            </label>
          ) : null}
          <button
            type="button"
            className="rounded bg-surface-container-highest/90 px-2 py-1 text-technical-label text-on-surface-variant backdrop-blur-sm hover:bg-surface-container-high"
            onClick={() => viewerRef.current?.fitToView()}
          >
            Ajustar vista
          </button>
        </div>

        <div ref={containerRef} className="relative h-[min(72vh,720px)] min-h-[480px] w-full">
          <CadViewer
            ref={viewerRef}
            file={dxfBuffer}
            theme="light"
            tool="pan"
            worker
            style={{ width: '100%', height: '100%', display: 'block' }}
            options={{ backgroundColor: '#ffffff' }}
            onLayersLoaded={handleLayersLoaded}
            onViewChange={(vt) => setViewTransform(vt)}
          />
          {showRoomOverlay && normalizedRooms.length > 0 ? (
            <RoomSvgOverlay
              rooms={normalizedRooms}
              viewTransform={viewTransform}
              width={canvasSize.width}
              height={canvasSize.height}
              selectedRoomId={selectedRoomId}
              roomProcessingState={renderData?.room_processing_state ?? {}}
              onRoomClick={onRoomClick}
            />
          ) : null}
          {showElectricalOverlay && electricalElements.length > 0 ? (
            <ElectricalSvgOverlay
              elements={electricalElements}
              viewTransform={viewTransform}
              width={canvasSize.width}
              height={canvasSize.height}
            />
          ) : null}
        </div>
      </div>

      <DxfLayerPanel
        layers={layerPanelState}
        onToggle={toggleLayer}
        onShowSuggested={showSuggested}
        onShowAll={showAll}
        onHideAll={hideAll}
      />
    </div>
  )
}
