"""Pure 2D geometry primitives for deterministic placement (no external deps).

All functions operate on drawing-unit coordinates. Points are (x, y) tuples;
polygons are ordered vertex lists (closed implicitly: last connects to first).
"""

from __future__ import annotations

import math

Point = tuple[float, float]
Segment = tuple[Point, Point]

EPS = 1e-9


def seg_length(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def point_at(a: Point, b: Point, t: float) -> Point:
    """Point on segment a→b at parameter t ∈ [0, 1]."""
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def project_param(p: Point, a: Point, b: Point) -> float:
    """Parameter t of the projection of p onto line a→b, clamped to [0, 1]."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    denom = dx * dx + dy * dy
    if denom < EPS:
        return 0.0
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom
    return min(1.0, max(0.0, t))


def point_seg_distance(p: Point, a: Point, b: Point) -> float:
    """Shortest distance from point p to segment a→b."""
    t = project_param(p, a, b)
    q = point_at(a, b, t)
    return math.hypot(p[0] - q[0], p[1] - q[1])


def polygon_edges(vertices: list[Point]) -> list[Segment]:
    """Ordered closed-polygon edges (last vertex connects back to the first)."""
    n = len(vertices)
    return [(vertices[i], vertices[(i + 1) % n]) for i in range(n)]


def polygon_area(vertices: list[Point]) -> float:
    """Unsigned shoelace area."""
    n = len(vertices)
    if n < 3:
        return 0.0
    acc = 0.0
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        acc += x1 * y2 - x2 * y1
    return abs(acc) / 2.0


def polygon_centroid(vertices: list[Point]) -> Point:
    """Area centroid; falls back to vertex mean for degenerate polygons."""
    n = len(vertices)
    if n == 0:
        return (0.0, 0.0)
    acc = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        acc += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(acc) < EPS:
        return (
            sum(v[0] for v in vertices) / n,
            sum(v[1] for v in vertices) / n,
        )
    return (cx / (3.0 * acc), cy / (3.0 * acc))


def point_in_polygon(p: Point, vertices: list[Point]) -> bool:
    """Ray-casting point-in-polygon (boundary points may go either way)."""
    n = len(vertices)
    if n < 3:
        return False
    x, y = p
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = vertices[i]
        xj, yj = vertices[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi + EPS) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def inward_normal(a: Point, b: Point, vertices: list[Point]) -> Point:
    """Unit normal of edge a→b pointing into the polygon.

    Probes the edge midpoint offset by a small fraction of the polygon size;
    falls back to pointing toward the centroid when both probes are ambiguous.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < EPS:
        return (0.0, 0.0)
    nx, ny = -dy / length, dx / length
    mid = point_at(a, b, 0.5)
    span = max(polygon_area(vertices) ** 0.5, seg_length(a, b))
    probe = max(span * 0.01, EPS * 10)
    if point_in_polygon((mid[0] + nx * probe, mid[1] + ny * probe), vertices):
        return (nx, ny)
    if point_in_polygon((mid[0] - nx * probe, mid[1] - ny * probe), vertices):
        return (-nx, -ny)
    cx, cy = polygon_centroid(vertices)
    vx, vy = cx - mid[0], cy - mid[1]
    norm = math.hypot(vx, vy)
    if norm < EPS:
        return (nx, ny)
    return (vx / norm, vy / norm)


def segments_collinear(
    a: Segment,
    b: Segment,
    *,
    angle_tol_deg: float = 15.0,
    gap_tol: float = 0.0,
) -> bool:
    """True when two segments are roughly parallel and lie on the same line.

    Used for the "distinct walls" rule: two placements share a wall when their
    supporting segments are collinear within tolerance.
    """
    (a1, a2), (b1, b2) = a, b
    va = (a2[0] - a1[0], a2[1] - a1[1])
    vb = (b2[0] - b1[0], b2[1] - b1[1])
    la = math.hypot(*va)
    lb = math.hypot(*vb)
    if la < EPS or lb < EPS:
        return False
    cross = abs(va[0] * vb[1] - va[1] * vb[0]) / (la * lb)
    if cross > math.sin(math.radians(angle_tol_deg)):
        return False
    # Parallel: check perpendicular distance from b1 to line(a).
    dist = abs((b1[0] - a1[0]) * va[1] - (b1[1] - a1[1]) * va[0]) / la
    return dist <= max(gap_tol, EPS)


def subtract_intervals(
    span: tuple[float, float],
    cuts: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Subtract closed intervals from a base interval; returns sorted remnants."""
    lo, hi = span
    if hi - lo < EPS:
        return []
    pieces: list[tuple[float, float]] = [(lo, hi)]
    for c_lo, c_hi in sorted(cuts):
        next_pieces: list[tuple[float, float]] = []
        for p_lo, p_hi in pieces:
            if c_hi <= p_lo or c_lo >= p_hi:
                next_pieces.append((p_lo, p_hi))
                continue
            if c_lo > p_lo:
                next_pieces.append((p_lo, min(c_lo, p_hi)))
            if c_hi < p_hi:
                next_pieces.append((max(c_hi, p_lo), p_hi))
        pieces = next_pieces
    return [(lo2, hi2) for lo2, hi2 in pieces if hi2 - lo2 > EPS]


def project_segment_onto_edge(
    seg: Segment,
    edge: Segment,
    *,
    max_distance: float,
) -> tuple[float, float] | None:
    """Projection interval (in edge drawing units from edge start) of a nearby segment.

    Returns None when the segment is farther than max_distance from the edge or
    the projected overlap is degenerate.
    """
    a, b = edge
    edge_len = seg_length(a, b)
    if edge_len < EPS:
        return None
    p1, p2 = seg
    if (
        point_seg_distance(p1, a, b) > max_distance
        and point_seg_distance(p2, a, b) > max_distance
    ):
        return None
    t1 = project_param(p1, a, b) * edge_len
    t2 = project_param(p2, a, b) * edge_len
    lo, hi = min(t1, t2), max(t1, t2)
    if hi - lo < EPS:
        return None
    return (lo, hi)


def bbox_center(footprint: dict[str, float]) -> Point:
    return (
        (footprint["min_x"] + footprint["max_x"]) / 2.0,
        (footprint["min_y"] + footprint["max_y"]) / 2.0,
    )


def bbox_corners(footprint: dict[str, float]) -> list[Point]:
    return [
        (footprint["min_x"], footprint["min_y"]),
        (footprint["max_x"], footprint["min_y"]),
        (footprint["max_x"], footprint["max_y"]),
        (footprint["min_x"], footprint["max_y"]),
    ]
