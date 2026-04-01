import { pipeline, env } from "@huggingface/transformers";
import { join } from "path";
import { homedir } from "os";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;
let embedder: FeatureExtractionPipeline | null = null;

export async function initEmbedder(): Promise<void> {
  if (embedder) return;

  // Cache models in ~/.context-pilot/models
  env.cacheDir = join(homedir(), ".context-pilot", "models");

  // Disable remote model fetching in offline mode if needed
  // env.allowRemoteModels = false;

  embedder = await pipeline("feature-extraction", MODEL_NAME, {
    dtype: "fp32",
  });
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!embedder) await initEmbedder();

  const BATCH_SIZE = 64;
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const output = await (embedder as Function)(batch, { pooling: "mean", normalize: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: number[][] = (output as any).tolist();
    for (const vec of list) {
      results.push(new Float32Array(vec));
    }
  }

  return results;
}

export async function embedSingle(text: string): Promise<Float32Array> {
  const [vec] = await embedTexts([text]);
  return vec;
}
