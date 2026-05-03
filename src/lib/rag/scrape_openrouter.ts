import type { Page } from "playwright";
import { newContext, parseNum } from "./playwright_helpers.ts";
import { fuzzyResolve, type FuzzyCandidate } from "./fuzzy_resolve.ts";
import type { ResolvedTarget } from "../models/opencode_go_catalog.ts";

const BASE = "https://openrouter.ai";
const API_MODELS = `${BASE}/api/v1/models`;

interface ORApiModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
  top_provider?: { context_length?: number; max_completion_tokens?: number | null };
  per_request_limits?: unknown;
}

let _apiCache: ORApiModel[] | null = null;
async function fetchApiModels(): Promise<ORApiModel[]> {
  if (_apiCache) return _apiCache;
  const res = await fetch(API_MODELS, {
    headers: { "User-Agent": "opencode-router/0.1" },
  });
  if (!res.ok) throw new Error(`openrouter /models ${res.status}`);
  const json = (await res.json()) as { data: ORApiModel[] };
  _apiCache = json.data;
  return _apiCache;
}

export interface OREffectivePricing {
  provider: string;
  weighted_input: number | null;
  weighted_output: number | null;
  cache_hit_rate: number | null;
}

export interface ORProviderRow {
  provider: string;
  region: string | null;
  quantization: string | null;
  latency_seconds: number | null;
  throughput_tps: number | null;
  uptime_percent: number | null;
  total_context: number | null;
  max_output: number | null;
  input_price_per_m: number | null;
  output_price_per_m: number | null;
  cache_read_per_m: number | null;
}

export interface ORResult {
  resolved_slug: string | null;
  source: "direct" | "fuzzy" | "unresolved";
  fuzzy_score?: number;
  api?: {
    id: string;
    name: string;
    context_length: number | null;
    input_price_per_m: number | null;
    output_price_per_m: number | null;
  };
  page?: {
    url: string;
    description: string | null;
    categories_top: string[];
    providers: ORProviderRow[];
    effective_pricing: OREffectivePricing[];
    design_arena_categories: Record<string, number>;
  };
  errors: string[];
}

async function tryGoto(page: Page, url: string): Promise<boolean> {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!res || res.status() >= 400) return false;
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Search bar fallback. OpenRouter dropdown formats results as "Provider: Model". */
async function searchCandidates(page: Page, query: string): Promise<FuzzyCandidate[]> {
  await page.goto(`${BASE}/models`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const search = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
  await search.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  await search.fill(query);
  await page.waitForTimeout(700);

  return await page
    .locator('[cmdk-item], [role="option"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const value = (n as HTMLElement).getAttribute("data-value") ?? "";
        const label = (n.textContent ?? "").trim();
        return { label: label || value, value };
      }),
    );
}

async function extractPage(page: Page, url: string): Promise<ORResult["page"]> {
  // Description
  const description = await page
    .locator("p")
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => null);

  // Top categories shown as chips like "Academia (#9)"
  const categories_top = await page
    .locator("a, span")
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent ?? "").trim())
        .filter((t) => /^[A-Za-z][A-Za-z &]+\s+\(#\d+\)$/.test(t)),
    );

  // Providers list — each card has provider, region, quantization, latency, throughput, uptime, prices
  const providers = await page
    .locator('[data-testid="provider-card"], section:has-text("Providers")')
    .evaluateAll((cards) => {
      const out: any[] = [];
      for (const card of cards) {
        const txt = (card.textContent ?? "").replace(/\s+/g, " ");
        // Heuristic split — selectors will need iteration once we see real DOM
        const provMatch = txt.match(/^([A-Za-z][\w. ]+?)(?:US|SE|SG|EU|JP|CN)/);
        if (!provMatch) continue;
        out.push({ provider: provMatch[1].trim(), raw: txt });
      }
      return out;
    });

  // Effective pricing table — last hour weighted average per provider
  const effective_pricing = await page
    .locator("table")
    .last()
    .evaluate((tbl) => {
      const rows = Array.from(tbl.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim()),
      );
      return rows
        .filter((r) => r.length >= 4)
        .map((r) => ({
          provider: r[0],
          weighted_input_raw: r[1],
          weighted_output_raw: r[2],
          cache_hit_rate_raw: r[3],
        }));
    })
    .catch(() => [] as any[]);

  return {
    url,
    description: description?.trim() ?? null,
    categories_top,
    providers: providers.map((p: any) => ({
      provider: p.provider,
      region: null,
      quantization: null,
      latency_seconds: null,
      throughput_tps: null,
      uptime_percent: null,
      total_context: null,
      max_output: null,
      input_price_per_m: null,
      output_price_per_m: null,
      cache_read_per_m: null,
    })),
    effective_pricing: effective_pricing.map((e: any) => ({
      provider: e.provider,
      weighted_input: parseNum(e.weighted_input_raw),
      weighted_output: parseNum(e.weighted_output_raw),
      cache_hit_rate: parseNum(e.cache_hit_rate_raw),
    })),
    design_arena_categories: {},
  };
}

export async function scrapeOR(target: ResolvedTarget): Promise<ORResult> {
  const errors: string[] = [];
  const result: ORResult = {
    resolved_slug: target.slug_or,
    source: target.slug_or ? "direct" : "unresolved",
    errors,
  };

  // 1. API metadata
  try {
    const all = await fetchApiModels();
    let apiHit = target.slug_or
      ? all.find((m) => m.id === target.slug_or)
      : undefined;

    if (!apiHit) {
      const candidates: FuzzyCandidate[] = all.map((m) => ({
        label: m.name,
        value: m.id,
      }));
      const res = fuzzyResolve({
        name: target.name,
        variant: target.variant,
        candidates,
        minScore: 75,
      });
      if (res.resolved && res.best) {
        apiHit = all.find((m) => m.id === res.best!.value);
        result.resolved_slug = apiHit?.id ?? null;
        result.source = "fuzzy";
        result.fuzzy_score = res.score;
      }
    }

    if (apiHit) {
      result.api = {
        id: apiHit.id,
        name: apiHit.name,
        context_length: apiHit.context_length ?? null,
        input_price_per_m:
          apiHit.pricing?.prompt != null
            ? parseFloat(apiHit.pricing.prompt) * 1_000_000
            : null,
        output_price_per_m:
          apiHit.pricing?.completion != null
            ? parseFloat(apiHit.pricing.completion) * 1_000_000
            : null,
      };
    } else {
      errors.push(`openrouter API: no match for "${target.name}"`);
      result.source = "unresolved";
      return result;
    }
  } catch (err) {
    errors.push(`openrouter API error: ${(err as Error).message}`);
    return result;
  }

  // 2. Detail page scraping
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const slug = result.resolved_slug!;
    const url = `${BASE}/${slug}`;
    const ok = await tryGoto(page, url);
    if (!ok) {
      // fuzzy via search
      try {
        const candidates = await searchCandidates(page, target.name);
        const res = fuzzyResolve({
          name: target.name,
          variant: target.variant,
          candidates,
          minScore: 75,
        });
        if (res.resolved && res.best) {
          // value here may be "Provider: Model" — keep API slug as canonical
          result.source = "fuzzy";
          result.fuzzy_score = res.score;
        } else {
          errors.push(`page 404 and fuzzy search failed for ${slug}`);
          return result;
        }
      } catch (err) {
        errors.push(`page error: ${(err as Error).message}`);
        return result;
      }
    }

    result.page = await extractPage(page, url);
  } finally {
    await page.close();
    await ctx.close();
  }

  return result;
}
