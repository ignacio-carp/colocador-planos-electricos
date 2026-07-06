/** Room count and warnings from preliminary analysis metadata. */

import type { JobRow } from './jobsStore'

export const PRELIMINARY_WARNING_NO_ROOMS = 'NO_ROOMS_DETECTED'

export function countRoomsInVisionLayout(meta: JobRow['pipeline_metadata']): number {
  const visionLayout = meta?.vision_layout as
    | { layout_interpretation?: { rooms?: unknown[] } }
    | undefined
  const rooms = visionLayout?.layout_interpretation?.rooms
  return Array.isArray(rooms) ? rooms.length : 0
}

export function hasNoRoomsWarning(meta: JobRow['pipeline_metadata']): boolean {
  const warnings = meta?.preliminary_analysis_warnings
  return Array.isArray(warnings) && warnings.includes(PRELIMINARY_WARNING_NO_ROOMS)
}

export function canReprocessPreliminaryAnalysis(job: JobRow): boolean {
  if (job.status === 'pendiente' || job.status === 'error') return true
  if (job.status !== 'listo_para_editar') return false
  return countRoomsInVisionLayout(job.pipeline_metadata) === 0 || hasNoRoomsWarning(job.pipeline_metadata)
}
