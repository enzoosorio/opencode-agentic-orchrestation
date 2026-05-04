import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { ChatOpenAI } from "@langchain/openai";
import {
  Features,
  FALLBACK_FEATURES,
  type Features as FeaturesT,
} from "../features/schema.ts";

const PROMPT = `You classify user inputs for an LLM router. Return a single JSON object with these exact keys:

{
  "task_type":         "coding"|"debug"|"refactor"|"research"|"writing"|"reasoning"|"summarization"|"translation"|"role_play"|"conversation"|"other",
  "domain":            "frontend"|"backend"|"data"|"devops"|"ml"|"security"|"general"|"other",
  "complexity":        "low"|"medium"|"high",
  "size_in_tokens":    integer (rough estimate of the input length),
  "size_out_estimated":"short"|"medium"|"long",
  "needs_tools":       boolean (true if the request requires tool calls / file access / web),
  "lang":              programming language slug or null,
  "needs_long_context":boolean,
  "scope":             "single_function"|"single_file"|"multi_file"|"project_wide"
}

CRITICAL: A short input can have project-wide scope. "implementa SEO a todo el proyecto" is 47 chars but scope=project_wide, complexity=high.
Return ONLY the JSON. No prose, no markdown fences.

USER INPUT:
"""
{input}
"""`;

interface ChatModel {
  invoke(input: string): Promise<{ content: unknown }>;
}

function buildModel(): ChatModel {
  const provider = (process.env.CLASSIFIER_PROVIDER ?? "anthropic").toLowerCase();
  const model = process.env.CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001";
  if (provider === "openai") {
    return new ChatOpenAI({
      model,
      temperature: 0,
      maxTokens: 300,
    }) as unknown as ChatModel;
  }
  if (provider === "deepseek") {
    return new ChatOpenAI({
      model,
      temperature: 0,
      maxTokens: 300,
      configuration: {
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
      },
    }) as unknown as ChatModel;
  }
  throw new Error(`unknown CLASSIFIER_PROVIDER=${provider}`);
}

const cache = new LRUCache<string, FeaturesT>({ max: 1000 });

function inputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function approxTokens(s: string): number {
  // Rough: 1 token ≈ 4 chars. Used only as fallback.
  return Math.ceil(s.length / 4);
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // strip ```json fences if model ignored instructions
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const body = fenced ? fenced[1] : trimmed;
  return JSON.parse(body);
}

export interface ClassifyResult {
  features: FeaturesT;
  cached: boolean;
  model: string;
  duration_ms: number;
}

let _model: ChatModel | null = null;

export async function classify(input: string): Promise<ClassifyResult> {
  const t0 = Date.now();
  const key = inputHash(input);
  const hit = cache.get(key);
  if (hit) {
    return {
      features: hit,
      cached: true,
      model: process.env.CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001",
      duration_ms: Date.now() - t0,
    };
  }

  if (!_model) _model = buildModel();
  const prompt = PROMPT.replace("{input}", input.replaceAll('"""', '\\"\\"\\"'));

  let features: FeaturesT;
  try {
    const res = await _model.invoke(prompt);
    const raw =
      typeof res.content === "string"
        ? res.content
        : Array.isArray(res.content)
          ? res.content
              .map((c) => (typeof c === "string" ? c : (c as any).text ?? ""))
              .join("")
          : "";
    const parsed = extractJson(raw);
    features = Features.parse({
      ...FALLBACK_FEATURES,
      size_in_tokens: approxTokens(input),
      ...(parsed as object),
    });
  } catch (err) {
    console.warn(`classifier failed, using fallback: ${(err as Error).message}`);
    features = { ...FALLBACK_FEATURES, size_in_tokens: approxTokens(input) };
  }

  cache.set(key, features);
  return {
    features,
    cached: false,
    model: process.env.CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001",
    duration_ms: Date.now() - t0,
  };
}
