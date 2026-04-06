import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { IContextEngine } from "@context-pilot/engine";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

export async function startUiServer(
  engine: IContextEngine,
  projectPath: string,
  port: number
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // ── Status ────────────────────────────────────────────────────────────────

  app.get("/api/status", async (_req, res) => {
    try {
      const status = await engine.status({ projectPath });
      res.json({ ...status, projectPath });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Graph ─────────────────────────────────────────────────────────────────

  app.get("/api/graph", async (_req, res) => {
    try {
      const graph = await engine.getFileGraph({ projectPath });
      res.json(graph);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Search ────────────────────────────────────────────────────────────────

  app.get("/api/search", async (req, res) => {
    const q = req.query.q as string;
    const k = Math.min(parseInt(req.query.k as string) || 15, 50);
    if (!q?.trim()) return res.json({ results: [] });
    try {
      const { results } = await engine.search({ query: q, projectPath, k });
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Memories ──────────────────────────────────────────────────────────────

  app.get("/api/memories", async (_req, res) => {
    try {
      const { memories } = await engine.listMemories({ projectPath });
      res.json({ memories });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/memories", async (req, res) => {
    const { content, memory_type } = req.body as { content: string; memory_type: string };
    if (!content?.trim()) return res.status(400).json({ error: "content required" });
    const validTypes = ["decision", "pattern", "todo", "context_note"] as const;
    const type = validTypes.includes(memory_type as typeof validTypes[number])
      ? (memory_type as typeof validTypes[number])
      : "context_note";
    try {
      const result = await engine.remember({
        projectPath,
        sessionId: "ui",
        memoryType: type,
        content: content.trim(),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const result = await engine.deleteMemory({
        projectPath,
        memoryId: req.params.id,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Co-edit ───────────────────────────────────────────────────────────────

  app.get("/api/coedits", async (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.json({});
    try {
      const graph = await engine.getFileGraph({ projectPath });
      const candidatePaths = graph.nodes.map((n) => n.path);
      const scores = engine.getCoEditScores({ projectPath, activeFilePath: file, candidatePaths });
      res.json(scores);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Catch-all (SPA) ───────────────────────────────────────────────────────

  app.get("*", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  return new Promise((resolve) => {
    app.listen(port, "127.0.0.1", () => resolve());
  });
}
