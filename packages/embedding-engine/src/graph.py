"""
Knowledge graph builder for context-pilot.
Nodes = chunks (functions, classes, modules).
Edges = import relationships, function calls, class inheritance.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Optional

try:
    import networkx as nx
    NX_AVAILABLE = True
except ImportError:
    NX_AVAILABLE = False


# ── Edge extraction from source code ──────────────────────────────────────────

_IMPORT_PATTERNS = [
    # Python: from foo import bar / import foo.bar
    re.compile(r"^(?:from|import)\s+([\w.]+)", re.MULTILINE),
    # TS/JS: import ... from './foo' or require('./foo')
    re.compile(r"""(?:import|require)\s*(?:\(?\s*['"])(\.{1,2}/[\w./]+)['"]"""),
    # TS/JS: export ... from './foo'
    re.compile(r"""export\s+.*?from\s+['\"](\.{1,2}/[\w./]+)['\"]"""),
]

_CALL_PATTERN = re.compile(r"\b(\w+)\s*\(")
_EXTENDS_PATTERN = re.compile(r"(?:extends|implements)\s+(\w+)")


def _extract_imports(content: str) -> list[str]:
    imports = []
    for pattern in _IMPORT_PATTERNS:
        imports.extend(pattern.findall(content))
    return list(set(imports))


def _extract_calls(content: str) -> list[str]:
    calls = _CALL_PATTERN.findall(content)
    # Filter out common keywords and builtins
    skip = {"if", "for", "while", "return", "print", "len", "range", "str",
             "int", "list", "dict", "set", "type", "super", "self", "cls"}
    return [c for c in calls if c not in skip]


def _extract_extends(content: str) -> list[str]:
    return _EXTENDS_PATTERN.findall(content)


# ── Graph construction ─────────────────────────────────────────────────────────

def build_graph(conn: sqlite3.Connection, project_id: str) -> "nx.DiGraph":
    if not NX_AVAILABLE:
        raise RuntimeError("networkx is not installed. Run: pip install networkx")

    G = nx.DiGraph()

    # Load all chunks with their file paths
    rows = conn.execute("""
        SELECT c.id, c.chunk_type, c.name, c.content, f.path
        FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE f.project_id = ?
    """, (project_id,)).fetchall()

    # name -> chunk_id index for resolving references
    name_index: dict[str, str] = {}

    for row in rows:
        G.add_node(row["id"], chunk_type=row["chunk_type"], name=row["name"], path=row["path"])
        if row["name"]:
            name_index[row["name"]] = row["id"]

    # Add edges based on imports, calls, and inheritance
    for row in rows:
        content = row["content"]
        chunk_id = row["id"]

        for call in _extract_calls(content):
            target_id = name_index.get(call)
            if target_id and target_id != chunk_id:
                G.add_edge(chunk_id, target_id, edge_type="calls", weight=0.8)

        for base in _extract_extends(content):
            target_id = name_index.get(base)
            if target_id and target_id != chunk_id:
                G.add_edge(chunk_id, target_id, edge_type="extends", weight=1.0)

    return G


def get_subgraph(
    G: "nx.DiGraph",
    target_chunk_id: str,
    depth: int = 2,
    direction: str = "both",
) -> dict:
    if target_chunk_id not in G:
        return {"nodes": [], "edges": [], "error": f"Node not found: {target_chunk_id}"}

    if direction == "outgoing":
        reachable = nx.descendants(G, target_chunk_id)
        subG = G.subgraph({target_chunk_id} | _limit_depth(G, target_chunk_id, depth, "out"))
    elif direction == "incoming":
        reachable = nx.ancestors(G, target_chunk_id)
        subG = G.subgraph({target_chunk_id} | _limit_depth(G, target_chunk_id, depth, "in"))
    else:
        out_nodes = _limit_depth(G, target_chunk_id, depth, "out")
        in_nodes = _limit_depth(G, target_chunk_id, depth, "in")
        subG = G.subgraph({target_chunk_id} | out_nodes | in_nodes)

    nodes = [
        {"id": n, **G.nodes[n]}
        for n in subG.nodes
    ]
    edges = [
        {"from": u, "to": v, **d}
        for u, v, d in subG.edges(data=True)
    ]
    return {"nodes": nodes, "edges": edges}


def _limit_depth(G: "nx.DiGraph", start: str, depth: int, direction: str) -> set[str]:
    visited: set[str] = set()
    frontier = {start}
    for _ in range(depth):
        next_frontier: set[str] = set()
        for node in frontier:
            if direction == "out":
                neighbors = set(G.successors(node))
            else:
                neighbors = set(G.predecessors(node))
            next_frontier |= neighbors - visited - {start}
        visited |= next_frontier
        frontier = next_frontier
    return visited


def get_graph_distances(
    G: "nx.DiGraph", source_chunk_id: str, target_ids: list[str]
) -> dict[str, float]:
    """
    Returns normalized distance [0,1] from source to each target.
    Closer = lower distance = higher relevance for ranking.
    """
    distances: dict[str, float] = {}
    if source_chunk_id not in G:
        return {t: 1.0 for t in target_ids}

    for target in target_ids:
        if target not in G:
            distances[target] = 1.0
            continue
        try:
            # Try both directions — undirected shortest path
            undirected = G.to_undirected()
            d = nx.shortest_path_length(undirected, source_chunk_id, target)
            # Normalize: distance 0=same, 1=very far (cap at 5)
            distances[target] = min(d / 5.0, 1.0)
        except nx.NetworkXNoPath:
            distances[target] = 1.0

    return distances


def find_chunk_by_name_or_path(
    conn: sqlite3.Connection, project_id: str, target: str
) -> Optional[str]:
    """Resolve a file path or function name to a chunk_id."""
    # Try exact function/class name match
    row = conn.execute("""
        SELECT c.id FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE f.project_id = ? AND c.name = ?
        LIMIT 1
    """, (project_id, target)).fetchone()
    if row:
        return row["id"]

    # Try file path match (return first chunk of that file)
    row = conn.execute("""
        SELECT c.id FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE f.project_id = ? AND f.path LIKE ?
        ORDER BY c.start_line ASC
        LIMIT 1
    """, (project_id, f"%{target}%")).fetchone()
    return row["id"] if row else None
