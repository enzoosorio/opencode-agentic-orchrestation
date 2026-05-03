import { promises as fs } from "node:fs";
import path from "node:path";
import {
  expandTargets,
  type ResolvedTarget,
} from "../models/opencode_go_catalog.ts";
import { scrapeAA, type AAResult } from "./scrape_artificialanalysis.ts";
import { scrapeOR, type ORResult } from "./scrape_openrouter.ts";
import { scrapeLiveBench, type LiveBenchResult } from "./scrape_livebench.ts";
import { checkOpencodeCatalog } from "./check_opencode_catalog.ts";
import { closeBrowser } from "./playwright_helpers.ts";
import { ScrapeLog } from "./scrape_log.ts";
import { getNotifier } from "../notify/index.ts";

const ROOT = path.resolve(process.cwd());
const PROFILES_PATH = path.join(ROOT, "src/lib/models/profiles.json");
const LOG_PATH = path.join(ROOT, "docs/scrape_log.md");

export interface ProfileEntry {
  model_name: string;
  variant: string;
  provider_used_by_opencode: string[];
  sdk: string;
  slug_oa: string | null;
  slug_or: string | null;
  context_window_tokens: number | null;
  pricing: {
    input_per_m: number | null;
    output_per_m: number | null;
    cache_hit_per_m: number | null;
    blended_7_2_1: number | null;
  };
  performance: {
    tokens_per_sec: number | null;
    ttft_seconds: number | null;
    end_to_end_seconds: number | null;
  };
  intelligence: {
    aa_index: number | null;
    aa_coding_index: number | null;
    aa_agentic_index: number | null;
    benchmarks: Record<string, number | null>;
    livebench: {
      reasoning: number | null;
      coding: number | null;
      agentic_coding: number | null;
      math: number | null;
      data: number | null;
      language: number | null;
      if: number | null;
    };
  };
  verbosity_tokens: number | null;
  cost_to_eval_usd: number | null;
  open_weights: boolean | null;
  params: { active: number | null; total: number | null };
  or_categories_top: string[];
  last_updated: string;
  source_urls: { artificialanalysis: string | null; openrouter: string | null; livebench: string };
}

function mergeOne(
  target: ResolvedTarget,
  aa: AAResult,
  or: ORResult,
  lb: LiveBenchResult,
): ProfileEntry {
  return {
    model_name: target.name,
    variant: target.variant,
    provider_used_by_opencode: target.providers_opencode,
    sdk: target.sdk,
    slug_oa: aa.resolved_slug,
    slug_or: or.resolved_slug,
    context_window_tokens:
      aa.general?.context_window_tokens ?? or.api?.context_length ?? null,
    pricing: {
      input_per_m:
        aa.general?.input_price_per_m ?? or.api?.input_price_per_m ?? null,
      output_per_m:
        aa.general?.output_price_per_m ?? or.api?.output_price_per_m ?? null,
      cache_hit_per_m: aa.general?.cache_hit_per_m ?? null,
      blended_7_2_1: aa.general?.blended_price_per_m ?? null,
    },
    performance: {
      tokens_per_sec: aa.general?.speed_tps ?? null,
      ttft_seconds: aa.general?.ttft_seconds ?? null,
      end_to_end_seconds: aa.general?.end_to_end_seconds ?? null,
    },
    intelligence: {
      aa_index: aa.general?.intelligence_index ?? null,
      aa_coding_index: aa.general?.coding_index ?? null,
      aa_agentic_index: aa.general?.agentic_index ?? null,
      benchmarks: aa.general?.benchmarks ?? {},
      livebench: {
        reasoning: lb.data?.reasoning_average ?? null,
        coding: lb.data?.coding_average ?? null,
        agentic_coding: lb.data?.agentic_coding_average ?? null,
        math: lb.data?.mathematics_average ?? null,
        data: lb.data?.data_analysis_average ?? null,
        language: lb.data?.language_average ?? null,
        if: lb.data?.if_average ?? null,
      },
    },
    verbosity_tokens: aa.general?.verbosity_tokens ?? null,
    cost_to_eval_usd: aa.general?.cost_to_eval_usd ?? null,
    open_weights: aa.general?.open_weights ?? null,
    params: {
      active: aa.general?.params_active ?? null,
      total: aa.general?.params_total ?? null,
    },
    or_categories_top: or.page?.categories_top ?? [],
    last_updated: new Date().toISOString(),
    source_urls: {
      artificialanalysis: aa.general?.url ?? null,
      openrouter: or.page?.url ?? null,
      livebench: "https://livebench.ai/#/?highunseenbias=true",
    },
  };
}

interface RunOptions {
  withProviders?: boolean;
  /** When true, do not write profiles.json or scrape_log.md */
  dryRun?: boolean;
  /** Limit how many targets we process (for smoke testing). */
  limit?: number;
}

export async function buildProfiles(opts: RunOptions = {}): Promise<{
  profiles: ProfileEntry[];
  log: ScrapeLog;
}> {
  const log = new ScrapeLog();
  const targets = expandTargets();
  const subset = opts.limit ? targets.slice(0, opts.limit) : targets;

  // 1. Catalog drift check
  const diff = await checkOpencodeCatalog();
  if (diff.errors.length) {
    for (const e of diff.errors) {
      log.add({ url: "opencode-catalog", action: "error", detail: e });
    }
  }
  for (const a of diff.added) {
    log.add({
      url: "https://opencode.ai/zen/go/v1/models",
      action: "model_added",
      detail: `${a} not in local catalog`,
    });
  }
  for (const r of diff.removed) {
    log.add({
      url: "https://opencode.ai/zen/go/v1/models",
      action: "model_removed",
      detail: `${r} no longer in opencode`,
    });
  }

  const profiles: ProfileEntry[] = [];

  for (const target of subset) {
    const label = `${target.name}/${target.variant}`;
    const [aa, or, lb] = await Promise.all([
      scrapeAA(target, { withProviders: opts.withProviders }).catch((err) => ({
        resolved_slug: null,
        source: "unresolved" as const,
        errors: [`AA fatal: ${(err as Error).message}`],
      })),
      scrapeOR(target).catch((err) => ({
        resolved_slug: null,
        source: "unresolved" as const,
        errors: [`OR fatal: ${(err as Error).message}`],
      })),
      scrapeLiveBench(target).catch((err) => ({
        matched_model: null,
        fuzzy_score: null,
        data: null,
        errors: [`LB fatal: ${(err as Error).message}`],
      })),
    ]);

    if (aa.general) {
      log.add({
        url: aa.general.url,
        action: "scrapped",
        detail: `${label} via ${aa.source}${aa.fuzzy_score ? ` (score ${aa.fuzzy_score})` : ""}`,
      });
    } else {
      log.add({
        url: `artificialanalysis:${target.name}`,
        action: "error",
        detail: `${label}: ${aa.errors.join("; ")}`,
      });
    }
    if (or.page) {
      log.add({
        url: or.page.url,
        action: "scrapped",
        detail: `${label} via ${or.source}${or.fuzzy_score ? ` (score ${or.fuzzy_score})` : ""}`,
      });
    } else {
      log.add({
        url: `openrouter:${target.name}`,
        action: "error",
        detail: `${label}: ${or.errors.join("; ")}`,
      });
    }
    if (lb.data) {
      log.add({
        url: "https://livebench.ai",
        action: "scrapped",
        detail: `${label}: matched "${lb.matched_model}" (score ${lb.fuzzy_score})`,
      });
    }

    profiles.push(mergeOne(target, aa as AAResult, or as ORResult, lb));
  }

  await closeBrowser();

  if (!opts.dryRun) {
    await fs.mkdir(path.dirname(PROFILES_PATH), { recursive: true });
    await fs.writeFile(PROFILES_PATH, JSON.stringify(profiles, null, 2));
    const today = new Date().toISOString().slice(0, 10);
    await log.appendToFile(LOG_PATH, today);
  }

  // Notify
  try {
    const counts = log.countByAction();
    const notifier = getNotifier();
    const lines: string[] = [
      `✅ ${counts.scrapped} scrapeos OK`,
    ];
    if (counts.error > 0) lines.push(`⚠️ ${counts.error} errores`);
    if (counts.model_added > 0)
      lines.push(`🆕 ${counts.model_added} modelo(s) nuevo(s) detectado(s)`);
    if (counts.model_removed > 0)
      lines.push(`➖ ${counts.model_removed} modelo(s) removido(s)`);
    await notifier.send({
      title: `🔄 Profiles refresh — ${new Date().toISOString().slice(0, 10)}`,
      lines,
    });
  } catch (err) {
    console.error(`notify failed: ${(err as Error).message}`);
  }

  return { profiles, log };
}

// CLI entry — `npm run fetch:profiles [-- --providers] [-- --dry] [-- --limit N]`
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/")) {
  const args = process.argv.slice(2);
  const opts: RunOptions = {
    withProviders: args.includes("--providers"),
    dryRun: args.includes("--dry"),
  };
  const limitIdx = args.indexOf("--limit");
  if (limitIdx >= 0) opts.limit = parseInt(args[limitIdx + 1] ?? "0", 10) || undefined;

  buildProfiles(opts)
    .then(({ profiles, log }) => {
      console.log(`built ${profiles.length} profiles`);
      console.log(`log entries: ${log.all.length}`);
      console.log(JSON.stringify(log.countByAction(), null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
