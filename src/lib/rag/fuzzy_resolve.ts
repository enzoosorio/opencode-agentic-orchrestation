import * as fuzz from "fuzzball";
import type { Variant } from "../models/opencode_go_catalog.ts";

export interface FuzzyCandidate {
  /** display label as scraped from the search dropdown */
  label: string;
  /** href / slug / id that we want to keep if this one wins */
  value: string;
  /** site-specific tag, e.g. "Language Models" or "Model Providers" on artificialanalysis */
  tag?: string;
}

export interface FuzzyResolveInput {
  name: string;
  variant?: Variant;
  /** site-specific candidate list returned by the search dropdown */
  candidates: FuzzyCandidate[];
  /**
   * If set, candidates whose `tag` does not match are demoted (-20 points).
   * Used to prioritize "Language Models" over "Model Providers" on artificialanalysis.
   */
  preferredTag?: string;
  /** Minimum acceptable score (0-100). Below this we treat as unresolved. */
  minScore?: number;
}

export interface FuzzyResolveResult {
  best: FuzzyCandidate | null;
  score: number;
  query_used: string;
  resolved: boolean;
}

function buildQueries(name: string, variant?: Variant): string[] {
  const q = [name];
  if (variant && variant !== "high") {
    q.push(`${name} ${variant}`);
    if (variant === "non-reasoning") q.push(`${name} non-reasoning`);
    if (variant === "max") q.push(`${name} max`);
  }
  return q;
}

export function fuzzyResolve(input: FuzzyResolveInput): FuzzyResolveResult {
  const { name, variant, candidates, preferredTag, minScore = 70 } = input;
  if (candidates.length === 0) {
    return { best: null, score: 0, query_used: name, resolved: false };
  }

  const queries = buildQueries(name, variant);
  let best: FuzzyCandidate | null = null;
  let bestScore = -Infinity;
  let bestQuery = name;

  for (const q of queries) {
    for (const cand of candidates) {
      const raw = fuzz.token_set_ratio(q, cand.label);
      const tagPenalty =
        preferredTag && cand.tag && cand.tag !== preferredTag ? -20 : 0;
      const score = raw + tagPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
        bestQuery = q;
      }
    }
  }

  return {
    best,
    score: bestScore,
    query_used: bestQuery,
    resolved: bestScore >= minScore,
  };
}
