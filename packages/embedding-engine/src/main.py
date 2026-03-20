"""
context-pilot embedding engine — JSON-RPC server over stdin/stdout.
TypeScript MCP server communicates with this process via IPC.

Protocol: Content-Length framing (same as LSP/MCP)
  Request:  Content-Length: N\r\n\r\n{"id":1,"method":"...","params":{...}}
  Response: Content-Length: N\r\n\r\n{"id":1,"result":{...}}
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

# Add src to path when running directly
sys.path.insert(0, str(Path(__file__).parent))

from storage import (
    open_db,
    upsert_project,
    upsert_file,
    get_file_hash,
    delete_file_chunks,
    insert_chunk,
    insert_embedding,
    get_all_embeddings,
)
from indexer import discover_files, index_file
from embedder import embed_texts, embed_single, DEFAULT_MODEL
from search import semantic_search
from graph import build_graph, get_subgraph, get_graph_distances, find_chunk_by_name_or_path

DB_PATH = str(Path.home() / ".context-pilot" / "db.sqlite")
_db = None
_embeddings_cache: dict[str, list[dict]] = {}  # project_id -> cached embeddings


def get_db():
    global _db
    if _db is None:
        _db = open_db(DB_PATH)
    return _db


# ── Handlers ──────────────────────────────────────────────────────────────────

def handle_index(params: dict) -> dict:
    project_path = params.get("project_path", os.getcwd())
    force = params.get("force", False)
    model = params.get("model", DEFAULT_MODEL)

    root = Path(project_path).resolve()
    if not root.exists():
        return {"success": False, "error": f"Path not found: {root}"}

    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(root)))
    db = get_db()
    upsert_project(db, project_id, root.name, str(root))

    files = discover_files(root)
    indexed = skipped = 0

    for file_path in files:
        file_id, relative, file_hash, chunks = index_file(file_path, root)
        existing_hash = get_file_hash(db, project_id, relative)

        if not force and existing_hash == file_hash:
            skipped += 1
            continue

        stat = file_path.stat()
        upsert_file(db, file_id, project_id, relative, chunks[0].chunk_type if chunks else "unknown", file_hash, int(stat.st_mtime))
        delete_file_chunks(db, file_id)

        if not chunks:
            continue

        # Embed all chunks in this file at once
        texts = [c.content for c in chunks]
        vectors = embed_texts(texts, model)

        for chunk, vector in zip(chunks, vectors):
            insert_chunk(db, chunk.id, file_id, chunk.chunk_type, chunk.name,
                         chunk.content, chunk.start_line, chunk.end_line, chunk.token_count)
            insert_embedding(db, chunk.id, model, vector)

        db.commit()
        indexed += 1

    # Invalidate cache for this project
    _embeddings_cache.pop(project_id, None)

    # Update indexed_at
    db.execute("UPDATE projects SET indexed_at=? WHERE id=?", (int(time.time()), project_id))
    db.commit()

    return {
        "success": True,
        "project_id": project_id,
        "project_path": str(root),
        "files_indexed": indexed,
        "files_skipped": skipped,
        "total_files": len(files),
    }


def handle_search(params: dict) -> dict:
    query = params.get("query", "")
    project_path = params.get("project_path", os.getcwd())
    k = params.get("k", 10)
    filter_type = params.get("filter_type", "any")
    model = params.get("model", DEFAULT_MODEL)

    root = Path(project_path).resolve()
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(root)))
    db = get_db()

    # Load and cache embeddings for this project
    if project_id not in _embeddings_cache:
        _embeddings_cache[project_id] = get_all_embeddings(db, project_id)

    candidates = _embeddings_cache[project_id]
    if not candidates:
        return {"results": [], "message": "Project not indexed. Call index first."}

    query_vector = embed_single(query, model)
    results = semantic_search(query_vector, candidates, k=k, filter_type=filter_type)
    return {"results": results}


def handle_status(params: dict) -> dict:
    project_path = params.get("project_path", os.getcwd())
    root = Path(project_path).resolve()
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(root)))
    db = get_db()

    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        return {"indexed": False, "project_path": str(root)}

    chunk_count = db.execute(
        "SELECT COUNT(*) as n FROM chunks c JOIN files f ON f.id=c.file_id WHERE f.project_id=?",
        (project_id,)
    ).fetchone()["n"]

    file_count = db.execute(
        "SELECT COUNT(*) as n FROM files WHERE project_id=?", (project_id,)
    ).fetchone()["n"]

    return {
        "indexed": True,
        "project_id": project_id,
        "project_path": str(root),
        "files": file_count,
        "chunks": chunk_count,
        "indexed_at": project["indexed_at"],
    }


_graph_cache: dict[str, object] = {}  # project_id -> nx.DiGraph


def handle_graph(params: dict) -> dict:
    target = params.get("target", "")
    project_path = params.get("project_path", os.getcwd())
    depth = params.get("depth", 2)
    direction = params.get("direction", "both")

    root = Path(project_path).resolve()
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(root)))
    db = get_db()

    if project_id not in _graph_cache:
        _graph_cache[project_id] = build_graph(db, project_id)

    G = _graph_cache[project_id]
    chunk_id = find_chunk_by_name_or_path(db, project_id, target)

    if not chunk_id:
        return {"nodes": [], "edges": [], "error": f"Target not found: {target}"}

    return get_subgraph(G, chunk_id, depth=depth, direction=direction)


def handle_graph_distances(params: dict) -> dict:
    """Internal method used by TypeScript ranker."""
    project_path = params.get("project_path", os.getcwd())
    active_chunk_id = params.get("active_chunk_id", "")
    candidate_ids = params.get("candidate_ids", [])

    root = Path(project_path).resolve()
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(root)))

    if project_id not in _graph_cache:
        db = get_db()
        _graph_cache[project_id] = build_graph(db, project_id)

    G = _graph_cache[project_id]
    distances = get_graph_distances(G, active_chunk_id, candidate_ids)
    return {"distances": distances}


HANDLERS = {
    "index": handle_index,
    "search": handle_search,
    "status": handle_status,
    "graph": handle_graph,
    "graph_distances": handle_graph_distances,
}


# ── IPC Protocol (Content-Length framing) ─────────────────────────────────────

def read_message() -> dict | None:
    header = sys.stdin.buffer.readline()
    if not header:
        return None
    if not header.startswith(b"Content-Length:"):
        return None
    length = int(header.split(b":")[1].strip())
    sys.stdin.buffer.readline()  # consume \r\n
    body = sys.stdin.buffer.read(length)
    return json.loads(body)


def write_message(msg: dict) -> None:
    body = json.dumps(msg).encode()
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode())
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def main() -> None:
    while True:
        try:
            msg = read_message()
            if msg is None:
                break

            msg_id = msg.get("id")
            method = msg.get("method", "")
            params = msg.get("params", {})

            handler = HANDLERS.get(method)
            if handler is None:
                write_message({"id": msg_id, "error": f"Unknown method: {method}"})
                continue

            result = handler(params)
            write_message({"id": msg_id, "result": result})

        except Exception as e:
            write_message({"id": None, "error": str(e)})


if __name__ == "__main__":
    main()
