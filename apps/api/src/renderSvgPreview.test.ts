import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDxfSvgPreview, readCachedDxfSvgPreview } from './renderSvgPreview'

describe('renderSvgPreview parsing', () => {
  it('parses a valid preview payload', () => {
    const preview = parseDxfSvgPreview({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
      svg_inner: '<path d="M0 0"/>',
      view_box: { x: 0, y: 0, w: 1000, h: 500 },
      dxf_bbox: { min_x: 0, min_y: 0, max_x: 100, max_y: 50 },
      entity_count: 12,
    })
    assert.ok(preview)
    assert.equal(preview!.svg_inner, '<path d="M0 0"/>')
    assert.equal(preview!.entity_count, 12)
  })

  it('rejects invalid view_box or bbox', () => {
    assert.equal(
      parseDxfSvgPreview({
        svg_inner: '<path/>',
        view_box: { x: 0, y: 0, w: 0, h: 10 },
        dxf_bbox: { min_x: 0, min_y: 0, max_x: 100, max_y: 50 },
      }),
      null,
    )
    assert.equal(
      parseDxfSvgPreview({
        svg_inner: '<path/>',
        view_box: { x: 0, y: 0, w: 100, h: 100 },
        dxf_bbox: { min_x: 0, min_y: 0, max_x: 0, max_y: 50 },
      }),
      null,
    )
  })

  it('reads cached preview from pipeline metadata', () => {
    const cached = readCachedDxfSvgPreview({
      dxf_svg_preview: {
        svg_inner: '<g/>',
        view_box: { x: 0, y: 0, w: 10, h: 10 },
        dxf_bbox: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      },
    })
    assert.ok(cached)
    assert.equal(cached!.svg_inner, '<g/>')
  })
})
