import type { Features } from "../features/schema.ts";
import type { ProfileEntry } from "../rag/build_profiles.ts";

export interface FeedbackStat {
  /** key = `${task_type}|${domain}|${complexity}` */
  key: string;
  model: string;
  variant: string;
  score: number; // [-1, +1]; net positive ⇒ users liked this model for this combo
  samples: number;
}

export interface RankedModel {
  model_name: string;
  variant: string;
  score: number;
  reasons: string[];
  blocked_reasons: string[];
  profile: ProfileEntry;
}

export interface RankerOptions {
  /** Activates feedback influence linearly between 0 and this many samples. */
  shadowThreshold?: number;
  /** Final list size returned to the caller. */
  topK?: number;
  /** Hard token-budget guard: if the input exceeds this fraction of the model context, we skip. */
  contextSafetyFactor?: number; // default 0.7 — leave headroom for the response
}

const DEFAULTS: Required<RankerOptions> = {
  shadowThreshold: 50,
  topK: 3,
  contextSafetyFactor: 0.7,
};

const TASK_BENCH_WEIGHT: Record<Features["task_type"], (p: ProfileEntry) => number> = {
  coding: (p) =>
    avg([p.intelligence.aa_coding_index, p.intelligence.livebench.coding]),
  debug: (p) =>
    avg([
      p.intelligence.livebench.coding,
      p.intelligence.livebench.reasoning,
    ]),
  refactor: (p) =>
    avg([
      p.intelligence.aa_coding_index,
      p.intelligence.livebench.agentic_coding,
    ]),
  research: (p) =>
    avg([
      p.intelligence.aa_index,
      p.intelligence.livebench.reasoning,
      p.intelligence.livebench.data,
    ]),
  writing: (p) =>
    avg([p.intelligence.livebench.language, p.intelligence.livebench.if]),
  reasoning: (p) =>
    avg([p.intelligence.aa_index, p.intelligence.livebench.reasoning]),
  summarization: (p) =>
    avg([p.intelligence.livebench.language, p.intelligence.livebench.if]),
  translation: (p) => p.intelligence.livebench.language,
  role_play: (p) => p.intelligence.livebench.if,
  conversation: (p) => p.intelligence.livebench.language,
  other: (p) => p.intelligence.aa_index,
};

function avg(values: Array<number | null | undefined>): number {
  const xs = values.filter((v): v is number => typeof v === "number");
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pricePenalty(p: ProfileEntry, sizeOut: Features["size_out_estimated"]): number {
  const out = p.pricing.output_per_m ?? p.pricing.input_per_m ?? 0;
  if (out === 0) return 0;
  // log scale so $0.5 vs $5 is meaningful but $5 vs $50 is not double-counted
  const baseline = Math.log10(Math.max(0.1, out));
  const sizeMultiplier = sizeOut === "long" ? 1.5 : sizeOut === "medium" ? 1 : 0.5;
  return baseline * sizeMultiplier * 5; // tuneable weight
}

function speedBonus(p: ProfileEntry, complexity: Features["complexity"]): number {
  const tps = p.performance.tokens_per_sec ?? 0;
  if (tps === 0) return 0;
  // For low-complexity tasks reward speed more; for high-complexity prefer intelligence
  const w = complexity === "low" ? 0.15 : complexity === "medium" ? 0.08 : 0.03;
  return Math.min(tps, 200) * w;
}

function contextOk(
  p: ProfileEntry,
  inTokens: number,
  needsLong: boolean,
  factor: number,
): { ok: boolean; reason?: string } {
  const ctx = p.context_window_tokens ?? 0;
  if (ctx === 0) return { ok: true }; // unknown ⇒ don't block
  if (inTokens > ctx * factor) {
    return {
      ok: false,
      reason: `input ${inTokens} tok > ${(factor * 100).toFixed(0)}% of ${ctx} ctx`,
    };
  }
  if (needsLong && ctx < 100_000) {
    return { ok: false, reason: `ctx ${ctx} too small for long-context request` };
  }
  return { ok: true };
}

function buildReasons(
  p: ProfileEntry,
  features: Features,
  benchScore: number,
  pricePen: number,
  speedB: number,
  fbAdj: number,
  fbWeight: number,
): string[] {
  const r: string[] = [];
  if (benchScore > 0) {
    r.push(
      `${features.task_type} fit ${benchScore.toFixed(0)} (AA/livebench)`,
    );
  }
  if (p.pricing.output_per_m != null) {
    r.push(`$${p.pricing.output_per_m.toFixed(2)}/M out`);
  }
  if (p.performance.tokens_per_sec != null) {
    r.push(`${p.performance.tokens_per_sec.toFixed(0)} t/s`);
  }
  if (p.context_window_tokens != null) {
    const k = (p.context_window_tokens / 1000).toFixed(0);
    r.push(`${k}k ctx`);
  }
  if (Math.abs(fbAdj) > 0.01 && fbWeight > 0) {
    r.push(
      `feedback ${fbAdj > 0 ? "+" : ""}${(fbAdj * 100).toFixed(0)}% (w=${fbWeight.toFixed(2)})`,
    );
  }
  // these are computed for traceability but not displayed in primary reasons
  void pricePen;
  void speedB;
  return r;
}

function feedbackKey(features: Features): string {
  return `${features.task_type}|${features.domain}|${features.complexity}`;
}

export function rank(
  features: Features,
  profiles: ProfileEntry[],
  feedback: FeedbackStat[] = [],
  options: RankerOptions = {},
): RankedModel[] {
  const opt = { ...DEFAULTS, ...options };
  const fbKey = feedbackKey(features);
  const fbByModel = new Map<string, FeedbackStat>();
  for (const f of feedback) {
    if (f.key !== fbKey) continue;
    fbByModel.set(`${f.model}|${f.variant}`, f);
  }

  const ranked: RankedModel[] = [];

  for (const p of profiles) {
    const ctx = contextOk(
      p,
      features.size_in_tokens,
      features.needs_long_context,
      opt.contextSafetyFactor,
    );
    if (!ctx.ok) {
      ranked.push({
        model_name: p.model_name,
        variant: p.variant,
        score: -Infinity,
        reasons: [],
        blocked_reasons: [ctx.reason!],
        profile: p,
      });
      continue;
    }

    const benchScore = TASK_BENCH_WEIGHT[features.task_type](p) ?? 0;
    const pricePen = pricePenalty(p, features.size_out_estimated);
    const speedB = speedBonus(p, features.complexity);

    const fbStat = fbByModel.get(`${p.model_name}|${p.variant}`);
    const fbWeight = fbStat
      ? Math.min(1, fbStat.samples / opt.shadowThreshold)
      : 0;
    const fbAdj = fbStat ? fbStat.score : 0;
    const fbBonus = fbAdj * fbWeight * 20; // scale to compete with bench points

    const score = benchScore - pricePen + speedB + fbBonus;

    ranked.push({
      model_name: p.model_name,
      variant: p.variant,
      score,
      reasons: buildReasons(p, features, benchScore, pricePen, speedB, fbAdj, fbWeight),
      blocked_reasons: [],
      profile: p,
    });
  }

  return ranked
    .filter((r) => r.score !== -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, opt.topK);
}
