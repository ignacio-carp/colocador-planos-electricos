import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertFileRow, selectOutputForCurrentInput, type FileRow } from './filesStore'

function file(
  id: string,
  kind: FileRow['kind'],
  createdAt: string,
  sourceInputFileId: string | null = null,
): FileRow {
  return {
    id,
    job_id: 'job-1',
    owner_user_id: 'owner-1',
    bucket_id: kind === 'input_dxf' ? 'job-dxf-input' : 'job-dxf-output',
    object_path: `${id}.dxf`,
    kind,
    content_type: 'application/dxf',
    size_bytes: 10,
    source_input_file_id: sourceInputFileId,
    created_at: createdAt,
  }
}

describe('DXF output lineage selection', () => {
  it('persists the exact source input id supplied by the generation flow', async () => {
    let inserted: Record<string, unknown> | undefined
    const returned = file('output-new', 'output_dxf', '2026-07-21T11:10:00.000Z', 'input-current')
    const supabase = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          inserted = payload
          return {
            select: () => ({
              single: async () => ({ data: returned, error: null }),
            }),
          }
        },
      }),
    } as unknown as SupabaseClient

    await insertFileRow(supabase, {
      job_id: 'job-1',
      owner_user_id: 'owner-1',
      bucket_id: 'job-dxf-output',
      object_path: 'output-new.dxf',
      kind: 'output_dxf',
      content_type: 'application/dxf',
      size_bytes: 10,
      source_input_file_id: 'input-current',
    })

    assert.equal(inserted?.source_input_file_id, 'input-current')
  })

  it('does not serve an old output after the input is replaced', () => {
    const oldInput = file('input-old', 'input_dxf', '2026-07-21T10:00:00.000Z')
    const oldOutput = file(
      'output-old',
      'output_dxf',
      '2026-07-21T10:05:00.000Z',
      oldInput.id,
    )
    const currentInput = file('input-current', 'input_dxf', '2026-07-21T11:00:00.000Z')

    assert.equal(
      selectOutputForCurrentInput([oldInput, oldOutput, currentInput], currentInput),
      null,
    )
  })

  it('selects only the newest output linked to the current input', () => {
    const currentInput = file('input-current', 'input_dxf', '2026-07-21T11:00:00.000Z')
    const first = file('output-1', 'output_dxf', '2026-07-21T11:05:00.000Z', currentInput.id)
    const latest = file('output-2', 'output_dxf', '2026-07-21T11:10:00.000Z', currentInput.id)

    assert.equal(selectOutputForCurrentInput([currentInput, latest, first], currentInput)?.id, latest.id)
  })

  it('rejects a legacy NULL-lineage output older than the current input', () => {
    const legacy = file('legacy-output', 'output_dxf', '2026-07-21T10:30:00.000Z')
    const currentInput = file('input-current', 'input_dxf', '2026-07-21T11:00:00.000Z')

    assert.equal(selectOutputForCurrentInput([legacy, currentInput], currentInput), null)
  })

  it('accepts a legacy NULL-lineage output only when timestamps establish it follows the current input', () => {
    const currentInput = file('input-current', 'input_dxf', '2026-07-21T11:00:00.000Z')
    const legacy = file('legacy-output', 'output_dxf', '2026-07-21T11:05:00.000Z')

    assert.equal(selectOutputForCurrentInput([currentInput, legacy], currentInput)?.id, legacy.id)
  })
})
