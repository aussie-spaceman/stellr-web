/**
 * One-off generator for lib/us-outline.ts — the conterminous-US state outlines
 * the landing-page location map draws.
 *
 * Run only when the outline needs regenerating:
 *   npx tsx scripts/build-us-outline.ts
 *
 * Why a generator and not a dependency: the map needs one static picture of the
 * United States. Pulling d3-geo + topojson + us-atlas into the client bundle to
 * redraw the same unchanging shape on every request would be several hundred
 * kilobytes for zero variability. So the projection runs here, once, and the
 * result is committed as plain path strings with no runtime deps at all.
 *
 * Source: us-atlas states-10m, itself derived from the US Census Bureau's
 * cartographic boundary files — a work of the US federal government and
 * therefore public domain.
 *
 * Projection: Albers equal-area conic, standard parallels 29.5°N / 45.5°N,
 * central meridian 96°W — the standard choice for a US thematic map, and the
 * same one lib/us-outline.ts re-implements so pins land where the outline says
 * they should. Alaska, Hawaii and the territories are dropped: every Stellr
 * location is in the lower 48, and a composite inset map costs a lot of code to
 * show two empty boxes.
 */
const SOURCE = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'
const OUT = 'lib/us-outline.ts'

/* Non-conterminous FIPS codes: Alaska, Hawaii, PR, VI, GU, AS, MP, and the
   Census "outlying" pseudo-states. */
const EXCLUDE = new Set(['02', '15', '60', '66', '69', '72', '74', '78'])

const VIEW_W = 960
const VIEW_H = 600
/** Douglas–Peucker tolerance in viewBox units. At 960 wide, 0.35 is invisible. */
const TOLERANCE = 0.35

type Ring = [number, number][]

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] }
  arcs: [number, number][][]
  objects: { states: { geometries: Geometry[] } }
}
interface Geometry {
  type: 'Polygon' | 'MultiPolygon'
  id: string
  arcs: number[][] | number[][][]
}

/* ── TopoJSON decoding ─────────────────────────────────────────────────────
 * Arcs are delta-encoded in quantised integer space; a negative arc index
 * means "traverse arc ~i backwards". Both are a handful of lines, which is why
 * this does not import topojson-client. */
function decodeArcs(topo: Topology): Ring[] {
  const { scale, translate } = topo.transform
  return topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number]
    })
  })
}

function stitch(arcIndexes: number[], arcs: Ring[]): Ring {
  const ring: Ring = []
  for (const idx of arcIndexes) {
    const arc = idx < 0 ? [...arcs[~idx]].reverse() : arcs[idx]
    // Consecutive arcs share an endpoint — drop the duplicate.
    ring.push(...(ring.length ? arc.slice(1) : arc))
  }
  return ring
}

/* ── Albers equal-area conic ───────────────────────────────────────────────── */
const RAD = Math.PI / 180
const PHI_0 = 37.5 * RAD
const PHI_1 = 29.5 * RAD
const PHI_2 = 45.5 * RAD
const LAMBDA_0 = -96 * RAD
const N = (Math.sin(PHI_1) + Math.sin(PHI_2)) / 2
const C = Math.cos(PHI_1) ** 2 + 2 * N * Math.sin(PHI_1)
const RHO_0 = Math.sqrt(C - 2 * N * Math.sin(PHI_0)) / N

/**
 * lon/lat degrees → Albers plane, with y negated for screen space.
 *
 * Textbook Albers gives a y that grows northward. SVG's y grows downward, so
 * without the negation the whole country renders upside down — self-consistently,
 * pins and coastline agreeing with each other, which is exactly why it is worth
 * stating: the bug looks like a correct map of a mirror universe.
 */
function albers(lon: number, lat: number): [number, number] {
  const theta = N * (lon * RAD - LAMBDA_0)
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * RAD)) / N
  return [rho * Math.sin(theta), rho * Math.cos(theta) - RHO_0]
}

/* ── Douglas–Peucker ───────────────────────────────────────────────────────── */
function perpDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p
  const [ax, ay] = a
  const [bx, by] = b
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(px - ax, py - ay)
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / len
}

function simplify(ring: Ring, tolerance: number): Ring {
  if (ring.length < 3) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = 1
  keep[ring.length - 1] = 1
  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let maxDist = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(ring[i], ring[first], ring[last])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return ring.filter((_, i) => keep[i] === 1)
}

async function main() {
  console.log(`Fetching ${SOURCE}`)
  const res = await fetch(SOURCE)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const topo = (await res.json()) as Topology
  const arcs = decodeArcs(topo)

  const geoms = topo.objects.states.geometries.filter((g) => !EXCLUDE.has(g.id))
  console.log(`${geoms.length} conterminous states + DC`)

  // Project every ring first so the bounding box and the tolerance are both in
  // the same space the SVG is drawn in.
  const projected: { id: string; rings: Ring[] }[] = geoms.map((g) => {
    const polygons = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][]
    return {
      id: g.id,
      rings: polygons.map((poly) =>
        stitch(poly[0], arcs).map(([lon, lat]) => albers(lon, lat)),
      ),
    }
  })

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { rings } of projected) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  // Uniform scale so the shape is not stretched, then centre it in the viewBox.
  const k = Math.min(VIEW_W / (maxX - minX), VIEW_H / (maxY - minY))
  const offsetX = (VIEW_W - (maxX - minX) * k) / 2 - minX * k
  const offsetY = (VIEW_H - (maxY - minY) * k) / 2 - minY * k

  const paths: string[] = []
  for (const { rings } of projected) {
    for (const ring of rings) {
      const screen = ring.map(([x, y]) => [x * k + offsetX, y * k + offsetY] as [number, number])
      const thin = simplify(screen, TOLERANCE)
      if (thin.length < 3) continue
      paths.push(
        'M' +
          thin.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') +
          'Z',
      )
    }
  }

  const body = `// GENERATED by scripts/build-us-outline.ts — do not edit by hand.
//
// Conterminous-US state outlines, Albers equal-area conic (standard parallels
// 29.5°N / 45.5°N, central meridian 96°W), pre-projected into a
// ${VIEW_W}×${VIEW_H} viewBox. Source: us-atlas states-10m, derived from US
// Census Bureau cartographic boundary files — public domain.
//
// Committed rather than computed so the map costs no runtime dependency and no
// projection work per request. \`project()\` below is the same transform the
// paths were built with, so a pin placed through it lands where the coastline
// says it should.

export const US_VIEWBOX = { width: ${VIEW_W}, height: ${VIEW_H} } as const

const RAD = Math.PI / 180
const PHI_0 = ${PHI_0}
const PHI_1 = ${PHI_1}
const PHI_2 = ${PHI_2}
const LAMBDA_0 = ${LAMBDA_0}
const N = ${N}
const C = ${C}
const RHO_0 = ${RHO_0}
const K = ${k}
const OFFSET_X = ${offsetX}
const OFFSET_Y = ${offsetY}

/** lon/lat in decimal degrees → x/y in the US_VIEWBOX coordinate space. */
export function project(lat: number, lng: number): { x: number; y: number } {
  const theta = N * (lng * RAD - LAMBDA_0)
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * RAD)) / N
  const x = rho * Math.sin(theta)
  // y negated for screen space — see scripts/build-us-outline.ts.
  const y = rho * Math.cos(theta) - RHO_0
  return { x: x * K + OFFSET_X, y: y * K + OFFSET_Y }
}
void PHI_1
void PHI_2

export const US_STATE_PATHS: readonly string[] = [
${paths.map((d) => `  '${d}',`).join('\n')}
]
`
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, body)
  console.log(`Wrote ${OUT} — ${paths.length} rings, ${(body.length / 1024).toFixed(0)}KB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
