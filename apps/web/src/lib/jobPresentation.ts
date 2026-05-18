/** Presentation helpers for jobs list / DWG metadata (US-004 / US-006). */

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

export function hasRegisteredDwgInput(files: readonly { kind: string }[]): boolean {
  return files.some((f) => f.kind === 'input_dwg')
}
