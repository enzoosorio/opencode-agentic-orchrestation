import { newContext } from "./playwright_helpers.ts";
import * as fuzz from "fuzzball";
import type { ResolvedTarget } from "../models/opencode_go_catalog.ts";

const BASE_URL = "https://livebench.ai/#/?highunseenbias=true";

function modelUrl(name: string): string {
  return `https://livebench.ai/#/?q=${encodeURIComponent(name)}&sort=Reasoning+Average&highunseenbias=true`;
}

export interface LiveBenchRow {
  model: string;
  organization: string;
  global_average: number | null;
  reasoning_average: number | null;
  coding_average: number | null;
  agentic_coding_average: number | null;
  mathematics_average: number | null;
  data_analysis_average: number | null;
  language_average: number | null;
  if_average: number | null;
}

let _rowsCache: LiveBenchRow[] | null = null;

async function fetchAllRows(): Promise<LiveBenchRow[]> {
  if (_rowsCache) return _rowsCache;
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const headers = await page
      .locator("table thead th")
      .allTextContents();
    const rows = await page
      .locator("table tbody tr")
      .evaluateAll((trs) =>
        trs.map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) =>
            (td.textContent ?? "").trim(),
          ),
        ),
      );
    const idx = (label: string) =>
      headers.findIndex((h) => h.toLowerCase().includes(label.toLowerCase()));
    const i = {
      model: idx("Model"),
      org: idx("Organization"),
      global: idx("Global"),
      reasoning: idx("Reasoning"),
      coding: idx("Coding Average"),
      agentic: idx("Agentic"),
      math: idx("Mathematics"),
      data: idx("Data Analysis"),
      language: idx("Language"),
      ifa: idx("IF"),
    };
    const num = (s: string | undefined): number | null => {
      if (!s) return null;
      const m = s.match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    };
    _rowsCache = rows
      .filter((r) => r.length > Math.max(...Object.values(i)))
      .map((r) => ({
        model: r[i.model] ?? "",
        organization: r[i.org] ?? "",
        global_average: num(r[i.global]),
        reasoning_average: num(r[i.reasoning]),
        coding_average: num(r[i.coding]),
        agentic_coding_average: num(r[i.agentic]),
        mathematics_average: num(r[i.math]),
        data_analysis_average: num(r[i.data]),
        language_average: num(r[i.language]),
        if_average: num(r[i.ifa]),
      }));
    return _rowsCache;
  } finally {
    await page.close();
    await ctx.close();
  }
}

export interface LiveBenchResult {
  matched_model: string | null;
  fuzzy_score: number | null;
  data: LiveBenchRow | null;
  url: string;
  errors: string[];
}

export async function scrapeLiveBench(
  target: ResolvedTarget,
): Promise<LiveBenchResult> {
  const url = modelUrl(target.name);
  try {
    const rows = await fetchAllRows();
    if (rows.length === 0) {
      return {
        matched_model: null,
        fuzzy_score: null,
        data: null,
        url,
        errors: ["livebench: no rows scraped (selectors likely broken)"],
      };
    }
    const queries = [target.name, `${target.name} ${target.variant}`];
    let best: LiveBenchRow | null = null;
    let bestScore = -1;
    for (const q of queries) {
      for (const row of rows) {
        const s = fuzz.token_set_ratio(q, row.model);
        if (s > bestScore) {
          bestScore = s;
          best = row;
        }
      }
    }
    return {
      matched_model: best?.model ?? null,
      fuzzy_score: bestScore,
      data: bestScore >= 75 ? best : null,
      url,
      errors: bestScore < 75 ? [`livebench: low fuzzy score ${bestScore}`] : [],
    };
  } catch (err) {
    return {
      matched_model: null,
      fuzzy_score: null,
      data: null,
      url,
      errors: [`livebench error: ${(err as Error).message}`],
    };
  }
}
