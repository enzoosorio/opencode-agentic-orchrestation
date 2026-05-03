import type { Page } from "playwright";
import { newContext, parseNum } from "./playwright_helpers.ts";
import { fuzzyResolve, type FuzzyCandidate } from "./fuzzy_resolve.ts";
import type {
  ResolvedTarget,
  Variant,
} from "../models/opencode_go_catalog.ts";

const BASE = "https://artificialanalysis.ai";

export interface AAGeneralData {
  url: string;
  intelligence_index: number | null;
  coding_index: number | null;
  agentic_index: number | null;
  speed_tps: number | null;
  ttft_seconds: number | null;
  end_to_end_seconds: number | null;
  input_price_per_m: number | null;
  output_price_per_m: number | null;
  cache_hit_per_m: number | null;
  blended_price_per_m: number | null;
  context_window_tokens: number | null;
  verbosity_tokens: number | null;
  cost_to_eval_usd: number | null;
  open_weights: boolean | null;
  params_active: number | null;
  params_total: number | null;
  benchmarks: Record<string, number | null>;
  raw_html_snapshot_path?: string;
}

export interface AAProviderData {
  url: string;
  providers: Array<{
    provider: string;
    tokens_per_sec: number | null;
    ttft_seconds: number | null;
    end_to_end_seconds: number | null;
    blended_price_per_m: number | null;
    input_price_per_m: number | null;
    output_price_per_m: number | null;
    cache_hit_per_m: number | null;
    context_window_tokens: number | null;
  }>;
}

export interface AAResult {
  resolved_slug: string | null;
  source: "direct" | "fuzzy" | "unresolved";
  fuzzy_score?: number;
  general?: AAGeneralData;
  by_provider?: AAProviderData;
  errors: string[];
}

async function tryGoto(page: Page, url: string): Promise<boolean> {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!res || res.status() >= 400) return false;
    // Wait briefly for client-side hydration of the headline numbers.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrape the artificialanalysis search bar and return the dropdown candidates.
 * Pattern observed: each result is an `<a id="/models/<slug>...">` containing
 * `<span class="truncate font-medium">NAME</span>` and a Badge with the tag
 * (either "Language Models" or "Model Providers").
 */
async function searchCandidates(page: Page, query: string): Promise<FuzzyCandidate[]> {
  await page.goto(`${BASE}/models`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const search = page.locator('input[placeholder*="earch" i], input[type="search"]').first();
  await search.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  await search.fill(query);
  await page.waitForTimeout(800); // debounce

  return await page
    .locator('a[id^="/models/"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const a = n as HTMLAnchorElement;
        const href = a.getAttribute("href") ?? a.id ?? "";
        const label =
          a.querySelector("span.truncate.font-medium")?.textContent?.trim() ?? "";
        const tag = Array.from(a.querySelectorAll("div"))
          .map((d) => d.textContent?.trim() ?? "")
          .find(
            (t) => t === "Language Models" || t === "Model Providers",
          );
        return { label, value: href, tag };
      }),
    );
}

async function extractGeneral(page: Page, url: string): Promise<AAGeneralData> {
  const txt = (await page.content()).replace(/\s+/g, " ");

  // Best-effort heuristic extraction of the headline cards on /models/<slug>.
  // The page has summary cards labelled "Artificial Analysis Intelligence Index",
  // "Output tokens per second", "Input Price", "Output Price", etc.
  const grab = (label: RegExp): string | null => {
    const m = txt.match(label);
    return m ? m[1] : null;
  };

  const intelligence = parseNum(
    grab(/Artificial Analysis Intelligence Index[^0-9$]*([0-9.]+)/i),
  );
  const speed = parseNum(grab(/Output tokens per second[^0-9$]*([0-9.]+)/i));
  const inputPrice = parseNum(grab(/Input Price[^$]*\$?([0-9.]+)/i));
  const outputPrice = parseNum(grab(/Output Price[^$]*\$?([0-9.]+)/i));
  const verbosity = parseNum(grab(/Output tokens from Intelligence Index[^0-9]*([0-9.]+\s*[KMB]?)/i));
  const ctx = parseNum(grab(/Context window[^0-9]*([0-9.]+\s*[kmKMbB]?)/i));

  // Per-benchmark scoreboards on the same page have model lists; we can't easily
  // pin OUR model's row without DOM-aware extraction, so leave null and let the
  // dedicated benchmark scrapers (livebench cross-check) fill these.
  const benchmarks: Record<string, number | null> = {
    gdpval_aa: null,
    terminal_bench_hard: null,
    tau2_telecom: null,
    aa_lcr: null,
    aa_omniscience_acc: null,
    aa_omniscience_nonhall: null,
    hle: null,
    gpqa_diamond: null,
    scicode: null,
    ifbench: null,
    critpt: null,
    mmmu_pro: null,
  };

  return {
    url,
    intelligence_index: intelligence,
    coding_index: null,
    agentic_index: null,
    speed_tps: speed,
    ttft_seconds: null,
    end_to_end_seconds: null,
    input_price_per_m: inputPrice,
    output_price_per_m: outputPrice,
    cache_hit_per_m: null,
    blended_price_per_m: null,
    context_window_tokens: ctx,
    verbosity_tokens: verbosity,
    cost_to_eval_usd: null,
    open_weights: /Open weights model/i.test(txt) ? true : null,
    params_active: null,
    params_total: null,
    benchmarks,
  };
}

async function extractProviders(
  page: Page,
  url: string,
  filterProviders: string[],
): Promise<AAProviderData> {
  // The /providers page renders a "Summary Table of Key Comparison Metrics".
  // We extract every row, then keep only those whose provider matches
  // the providers opencode actually uses.
  const rows = await page
    .locator('table tbody tr, [role="table"] [role="row"]')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll("td, [role='cell']")).map((td) =>
          (td.textContent ?? "").trim(),
        ),
      ),
    );

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const wanted = new Set(filterProviders.map(norm));

  const providers: AAProviderData["providers"] = [];
  for (const cells of rows) {
    if (cells.length < 4) continue;
    const provName = cells[0];
    if (!provName) continue;
    if (!wanted.has(norm(provName))) continue;

    // Column layout from the example:
    // [provider, model, context, license, blended$, t/s, ttft, e2e, reasoning_time]
    providers.push({
      provider: provName,
      context_window_tokens: parseNum(cells[2]),
      blended_price_per_m: parseNum(cells[4]),
      tokens_per_sec: parseNum(cells[5]),
      ttft_seconds: parseNum(cells[6]),
      end_to_end_seconds: parseNum(cells[7]),
      input_price_per_m: null,
      output_price_per_m: null,
      cache_hit_per_m: null,
    });
  }

  return { url, providers };
}

export async function scrapeAA(
  target: ResolvedTarget,
  opts: { withProviders?: boolean } = {},
): Promise<AAResult> {
  const errors: string[] = [];
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    let slug = target.slug_oa;
    let source: AAResult["source"] = "direct";
    let fuzzyScore: number | undefined;

    // 1. direct URL
    let ok = false;
    if (slug) {
      ok = await tryGoto(page, `${BASE}/models/${slug}`);
    }

    // 2. fuzzy fallback
    if (!ok) {
      try {
        const candidates = await searchCandidates(page, target.name);
        const res = fuzzyResolve({
          name: target.name,
          variant: target.variant as Variant,
          candidates,
          preferredTag: "Language Models",
        });
        if (res.resolved && res.best) {
          slug = res.best.value.replace(/^\/models\//, "").replace(/\/.*$/, "");
          source = "fuzzy";
          fuzzyScore = res.score;
          ok = await tryGoto(page, `${BASE}/models/${slug}`);
        } else {
          source = "unresolved";
          errors.push(
            `fuzzy resolve failed for "${target.name}" (${target.variant}); top score ${res.score}`,
          );
        }
      } catch (err) {
        errors.push(`search dropdown error: ${(err as Error).message}`);
        source = "unresolved";
      }
    }

    if (!ok || !slug) {
      return { resolved_slug: null, source: "unresolved", errors };
    }

    const generalUrl = `${BASE}/models/${slug}`;
    const general = await extractGeneral(page, generalUrl);

    let by_provider: AAProviderData | undefined;
    if (opts.withProviders) {
      const provUrl = `${BASE}/models/${slug}/providers`;
      const okProv = await tryGoto(page, provUrl);
      if (okProv) {
        by_provider = await extractProviders(page, provUrl, target.providers_opencode);
      } else {
        errors.push(`providers page 404 for ${slug}`);
      }
    }

    return {
      resolved_slug: slug,
      source,
      fuzzy_score: fuzzyScore,
      general,
      by_provider,
      errors,
    };
  } finally {
    await page.close();
    await ctx.close();
  }
}
