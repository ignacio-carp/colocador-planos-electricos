import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CadWorkerError,
  cadWorkerDisabled,
  cadWorkerTransport,
  renderSvgFromDxf,
  type CadWorkerSvgBBox,
  type CadWorkerSvgViewBox,
} from './cadWorkerBridge'
import { DXF_INPUT_BUCKET } from './dxfStorage'
import { findLatestInputForJob } from './filesStore'
import { logStructured } from './logger'
import { findJob, patchJob, type JobPipelineMetadata } from './jobsStore'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type DxfSvgPreview = {
  svg: string
  svg_inner: string
  view_box: CadWorkerSvgViewBox
  dxf_bbox: CadWorkerSvgBBox
  entity_count?: number
  generated_at?: string
}

function cadWorkerFixturePath(): string | undefined {
  return (
    process.env.CAD_WORKER_FIXTURE_DXF?.trim() ||
    process.env.CAD_WORKER_FIXTURE_DWG?.trim() ||
    undefined
  )
}

async function downloadInputDxfToTemp(
  jobId: string,
): Promise<{ localPath: string } | null> {
  if (!isStorageConfigured()) return null
  const supabase = getSupabaseServiceRole()
  const input = await findLatestInputForJob(supabase, jobId)
  if (input?.bucket_id !== DXF_INPUT_BUCKET || !input.object_path) return null
  const { data, error } = await supabase.storage.from(input.bucket_id).download(input.object_path)
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not download input DXF')
  }
  const dir = mkdtempSync(join(tmpdir(), 'cambre-cad-svg-'))
  const localPath = join(dir, 'input.dxf')
  writeFileSync(localPath, Buffer.from(await data.arrayBuffer()))
  return { localPath }
}

function isValidViewBox(viewBox: unknown): viewBox is CadWorkerSvgViewBox {
  if (!viewBox || typeof viewBox !== 'object') return false
  const vb = viewBox as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof vb[k] === 'number' && Number.isFinite(vb[k] as number))
    && (vb.w as number) > 0
    && (vb.h as number) > 0
}

function isValidDxfBBox(bbox: unknown): bbox is CadWorkerSvgBBox {
  if (!bbox || typeof bbox !== 'object') return false
  const b = bbox as Record<string, unknown>
  if (
    !['min_x', 'min_y', 'max_x', 'max_y'].every(
      (k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number),
    )
  ) {
    return false
  }
  return (b.max_x as number) > (b.min_x as number) && (b.max_y as number) > (b.min_y as number)
}

export function parseDxfSvgPreview(raw: unknown): DxfSvgPreview | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const svgInner = typeof item.svg_inner === 'string' ? item.svg_inner.trim() : ''
  const svg = typeof item.svg === 'string' ? item.svg.trim() : ''
  if (!svgInner && !svg) return null
  if (!isValidViewBox(item.view_box) || !isValidDxfBBox(item.dxf_bbox)) return null
  return {
    svg: svg || `<svg xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>`,
    svg_inner: svgInner,
    view_box: item.view_box,
    dxf_bbox: item.dxf_bbox,
    entity_count: typeof item.entity_count === 'number' ? item.entity_count : undefined,
    generated_at: typeof item.generated_at === 'string' ? item.generated_at : undefined,
  }
}

export function readCachedDxfSvgPreview(meta: JobPipelineMetadata | undefined): DxfSvgPreview | null {
  return parseDxfSvgPreview(meta?.dxf_svg_preview)
}

async function renderSvgForJob(jobId: string, correlationId: string): Promise<DxfSvgPreview | null> {
  if (cadWorkerDisabled()) return null

  const fixture = cadWorkerFixturePath()
  const inputPath = fixture ?? (await downloadInputDxfToTemp(jobId))?.localPath
  if (!inputPath) return null

  try {
    const result = await renderSvgFromDxf(inputPath)
    const preview = parseDxfSvgPreview({
      svg: result.svg,
      svg_inner: result.svg_inner,
      view_box: result.view_box,
      dxf_bbox: result.dxf_bbox,
      entity_count: result.entity_count,
      generated_at: new Date().toISOString(),
    })
    logStructured('info', {
      event: 'cad_worker_render_svg',
      job_id: jobId,
      correlation_id: correlationId,
      source: fixture ? 'fixture' : 'storage',
      cad_worker_transport: cadWorkerTransport(),
      entity_count: preview?.entity_count,
      has_preview: Boolean(preview),
    })
    return preview
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logStructured('warn', {
      event: 'cad_worker_render_svg_failed',
      job_id: jobId,
      correlation_id: correlationId,
      error: message,
      error_code: e instanceof CadWorkerError ? e.code : undefined,
    })
    return null
  }
}

/** Returns cached preview or generates on demand and persists to pipeline_metadata. */
export async function resolveDxfSvgPreview(
  jobId: string,
  meta: JobPipelineMetadata | undefined,
  correlationId = 'render-data',
): Promise<DxfSvgPreview | null> {
  const cached = readCachedDxfSvgPreview(meta)
  if (cached) return cached

  const preview = await renderSvgForJob(jobId, correlationId)
  if (!preview) return null

  const job = await findJob(jobId)
  if (job) {
    await patchJob(jobId, {
      pipeline_metadata: {
        ...(job.pipeline_metadata ?? {}),
        dxf_svg_preview: preview,
      },
    })
  }
  return preview
}

export async function runCadWorkerRenderSvg(
  jobId: string,
  correlationId: string,
): Promise<DxfSvgPreview | null> {
  return renderSvgForJob(jobId, correlationId)
}
