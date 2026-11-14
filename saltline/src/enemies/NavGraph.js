/**
 * NavGraph — waypoint navigation graph with A* pathfinding.
 * The web port equivalent of Unity's NavMesh: the level builder hands us
 * hand-placed waypoints and a list of blocking boxes; edges between
 * waypoints are only created when the straight segment is not blocked.
 * Engine-agnostic (plain objects) so it is unit-testable in Node.
 */
import { dist2D } from '../core/Utils.js';

/** Line segment vs AABB (slab test). Returns true if the segment passes through the box. */
export function segmentIntersectsAABB(ax, az, bx, bz, minx, minz, maxx, maxz) {
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  for (const [p, d, mn, mx] of [[ax, dx, minx, maxx], [az, dz, minz, maxz]]) {
    if (Math.abs(d) < 1e-8) {
      if (p < mn || p > mx) return false;
    } else {
      let t1 = (mn - p) / d, t2 = (mx - p) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export class NavGraph {
  /**
   * @param {Array<{x:number,z:number}>} waypoints
   * @param {Array<{minx,minz,maxx,maxz}>} [blockers] AABBs that block edges (2D)
   * @param {number} [maxEdge=24] maximum edge length (m)
   */
  constructor(waypoints, blockers = [], maxEdge = 24) {
    this.nodes = waypoints.map((w) => ({ x: w.x, z: w.z }));
    this.adj = this.nodes.map(() => []);
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        const d = dist2D(a.x, a.z, b.x, b.z);
        if (d > maxEdge || d < 0.01) continue;
        let blocked = false;
        for (const bk of blockers) {
          if (segmentIntersectsAABB(a.x, a.z, b.x, b.z, bk.minx, bk.minz, bk.maxx, bk.maxz)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        this.adj[i].push(j);
        this.adj[j].push(i);
      }
    }
  }

  nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = dist2D(x, z, this.nodes[i].x, this.nodes[i].z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** A* from position (sx,sz) to (tx,tz). Returns array of {x,z} incl. endpoints, or null. */
  findPath(sx, sz, tx, tz) {
    const start = this.nearestNode(sx, sz);
    let goal = this.nearestNode(tx, tz);
    if (this.nodes.length === 0) return null;
    // if start and goal share a node, trivial path
    if (start === goal) return [{ x: sx, z: sz }, { x: tx, z: tz }];

    const n = this.nodes.length;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    g[start] = 0;
    const open = [start];

    const heuristic = (i) => dist2D(this.nodes[i].x, this.nodes[i].z, tx, tz);
    let guard = 0;
    while (open.length && guard++ < 4000) {
      // extract min f
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        const fi = g[open[i]] + heuristic(open[i]);
        const fb = g[open[bi]] + heuristic(open[bi]);
        if (fi < fb) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const nb of this.adj[cur]) {
        if (closed[nb]) continue;
        const step = dist2D(this.nodes[cur].x, this.nodes[cur].z, this.nodes[nb].x, this.nodes[nb].z);
        const ng = g[cur] + step;
        if (ng < g[nb]) {
          g[nb] = ng;
          from[nb] = cur;
          open.push(nb);
        }
      }
    }

    if (!closed[goal] && g[goal] === Infinity) {
      // unreachable — return straight line as last resort
      return [{ x: sx, z: sz }, { x: tx, z: tz }];
    }
    const path = [];
    let cur = goal;
    while (cur !== -1) {
      path.unshift({ x: this.nodes[cur].x, z: this.nodes[cur].z });
      cur = from[cur];
    }
    path.unshift({ x: sx, z: sz });
    path.push({ x: tx, z: tz });
    return path;
  }

  /** A random neighbouring node (for patrol routes). */
  randomNeighbour(idx) {
    const adj = this.adj[idx];
    if (!adj || !adj.length) return idx;
    return adj[Math.floor(Math.random() * adj.length)];
  }
}
