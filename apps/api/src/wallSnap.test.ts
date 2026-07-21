import assert from 'node:assert/strict'
import test from 'node:test'
import { duPerMm, pointInPolygon, snapPositionsForAdd } from './wallSnap'

// Room 3000×4000 mm, four single-line walls, standard fixture of the
// placement spec (docs/placement-spec/reglas-dormitorio-tomas-v1.md).
const WALLS = [
  { inicio: [0, 0], fin: [3000, 0] },
  { inicio: [3000, 0], fin: [3000, 4000] },
  { inicio: [3000, 4000], fin: [0, 4000] },
  { inicio: [0, 4000], fin: [0, 0] },
]
const POLYGON = [
  { x: 0, y: 0 },
  { x: 3000, y: 0 },
  { x: 3000, y: 4000 },
  { x: 0, y: 4000 },
]

test('duPerMm consumes worker drawing_units_per_meter and has an explicit legacy fallback', () => {
  assert.equal(duPerMm(1000), 1)
  assert.equal(duPerMm(1), 0.001)
  assert.equal(duPerMm(null), 1)
  assert.equal(duPerMm(null, 6), 0.001)
})

test('snaps an interior point to the nearest wall, nudged 10 mm inward', () => {
  const points = snapPositionsForAdd({
    base: { x: 1500, y: 300 },
    count: 1,
    walls: WALLS,
    polygon: POLYGON,
    drawingUnitsPerMeter: 1000,
  })
  assert.equal(points.length, 1)
  assert.ok(Math.abs(points[0]!.x - 1500) < 1e-6)
  assert.ok(Math.abs(points[0]!.y - 10) < 1e-6) // south wall, 10 mm inside
  assert.equal(pointInPolygon(points[0]!, POLYGON), true)
})

test('snaps from the room center but rejects positions with no wall in reach', () => {
  const center = snapPositionsForAdd({
    base: { x: 1500, y: 2000 }, // 1.5 m from the nearest wall < 2 m → snaps
    count: 1,
    walls: WALLS,
    polygon: POLYGON,
    drawingUnitsPerMeter: 1000,
  })
  assert.equal(center.length, 1)

  const farAway = snapPositionsForAdd({
    base: { x: 50_000, y: 50_000 }, // no wall within 2 m
    count: 1,
    walls: WALLS,
    polygon: POLYGON,
    drawingUnitsPerMeter: 1000,
  })
  assert.equal(farAway.length, 0)
})

test('spaces multiple copies 600 mm apart along the same wall', () => {
  const points = snapPositionsForAdd({
    base: { x: 1500, y: 100 },
    count: 3,
    walls: WALLS,
    polygon: POLYGON,
    drawingUnitsPerMeter: 1000,
  })
  assert.equal(points.length, 3)
  for (const p of points) {
    assert.ok(Math.abs(p.y - 10) < 1e-6)
    assert.equal(pointInPolygon(p, POLYGON), true)
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)
      assert.ok(d >= 599, `separación ${d} < 600 mm`)
    }
  }
})

test('scales tolerances with meter units', () => {
  const points = snapPositionsForAdd({
    base: { x: 1.5, y: 0.3 },
    count: 1,
    walls: [
      { inicio: [0, 0], fin: [3, 0] },
      { inicio: [3, 0], fin: [3, 4] },
      { inicio: [3, 4], fin: [0, 4] },
      { inicio: [0, 4], fin: [0, 0] },
    ],
    polygon: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ],
    drawingUnitsPerMeter: 1,
  })
  assert.equal(points.length, 1)
  assert.ok(Math.abs(points[0]!.y - 0.01) < 1e-9) // 10 mm in metres
})
