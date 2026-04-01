export interface NodeAttrs {
  chunkType: string;
  name: string | null;
  path: string;
}

export interface EdgeAttrs {
  edgeType: string;
  weight: number;
}

export class DiGraph {
  private nodes = new Map<string, NodeAttrs>();
  private outEdges = new Map<string, Map<string, EdgeAttrs>>();
  private inEdges = new Map<string, Set<string>>();

  addNode(id: string, attrs: NodeAttrs): void {
    this.nodes.set(id, attrs);
    if (!this.outEdges.has(id)) this.outEdges.set(id, new Map());
    if (!this.inEdges.has(id)) this.inEdges.set(id, new Set());
  }

  addEdge(from: string, to: string, attrs: EdgeAttrs): void {
    if (!this.outEdges.has(from)) this.outEdges.set(from, new Map());
    if (!this.inEdges.has(to)) this.inEdges.set(to, new Set());
    this.outEdges.get(from)!.set(to, attrs);
    this.inEdges.get(to)!.add(from);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): NodeAttrs | undefined {
    return this.nodes.get(id);
  }

  successors(id: string): string[] {
    return [...(this.outEdges.get(id)?.keys() ?? [])];
  }

  predecessors(id: string): string[] {
    return [...(this.inEdges.get(id) ?? [])];
  }

  getEdge(from: string, to: string): EdgeAttrs | undefined {
    return this.outEdges.get(from)?.get(to);
  }

  allNodes(): Array<[string, NodeAttrs]> {
    return [...this.nodes.entries()];
  }

  allEdges(): Array<{ from: string; to: string; attrs: EdgeAttrs }> {
    const result: Array<{ from: string; to: string; attrs: EdgeAttrs }> = [];
    for (const [from, tos] of this.outEdges) {
      for (const [to, attrs] of tos) {
        result.push({ from, to, attrs });
      }
    }
    return result;
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * BFS subgraph starting from `rootId`, up to `depth` hops.
   * direction: "outgoing" | "incoming" | "both"
   */
  subgraph(
    rootId: string,
    depth: number,
    direction: "outgoing" | "incoming" | "both"
  ): { nodeIds: Set<string>; edges: Array<{ from: string; to: string; attrs: EdgeAttrs }> } {
    const visited = new Set<string>([rootId]);
    const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: 0 }];
    const edges: Array<{ from: string; to: string; attrs: EdgeAttrs }> = [];

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;

      const neighbors: string[] = [];
      if (direction === "outgoing" || direction === "both") neighbors.push(...this.successors(id));
      if (direction === "incoming" || direction === "both") neighbors.push(...this.predecessors(id));

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, d: d + 1 });
        }
        // collect edges in original direction
        if (this.outEdges.get(id)?.has(neighbor)) {
          edges.push({ from: id, to: neighbor, attrs: this.getEdge(id, neighbor)! });
        } else if (this.outEdges.get(neighbor)?.has(id)) {
          edges.push({ from: neighbor, to: id, attrs: this.getEdge(neighbor, id)! });
        }
      }
    }

    return { nodeIds: visited, edges };
  }

  /**
   * Compute normalized shortest-path distances from `sourceId` to each candidate.
   * Uses BFS on undirected version. Returns 0–1 where 0 = same node, 1 = unreachable.
   */
  shortestPathDistances(sourceId: string, targetIds: string[]): Record<string, number> {
    const dist = new Map<string, number>();
    const queue: Array<{ id: string; d: number }> = [{ id: sourceId, d: 0 }];
    dist.set(sourceId, 0);

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      const neighbors = [...this.successors(id), ...this.predecessors(id)];
      for (const n of neighbors) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push({ id: n, d: d + 1 });
        }
      }
    }

    const maxDist = Math.max(1, ...dist.values());
    const result: Record<string, number> = {};

    for (const targetId of targetIds) {
      const d = dist.get(targetId);
      result[targetId] = d === undefined ? 1.0 : Math.min(1.0, d / maxDist);
    }

    return result;
  }
}
