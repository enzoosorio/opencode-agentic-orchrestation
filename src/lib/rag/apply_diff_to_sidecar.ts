import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogAddition, Variant } from "../models/opencode_go_catalog.ts";
import type { CatalogDiff } from "./check_opencode_catalog.ts";

const ADDITIONS_PATH = path.resolve(
  process.cwd(),
  "src/lib/models/catalog_additions.json",
);

export function readAdditions(): CatalogAddition[] {
  try {
    return JSON.parse(readFileSync(ADDITIONS_PATH, "utf-8")) as CatalogAddition[];
  } catch {
    return [];
  }
}

export async function applyDiffToSidecar(
  diff: CatalogDiff,
  dryRun = false,
): Promise<void> {
  if (diff.added.length === 0 && diff.removed.length === 0) return;

  const additions = readAdditions();
  const existingNames = new Set(additions.map((a) => a.name.toLowerCase()));
  let changed = false;

  for (const name of diff.added) {
    if (existingNames.has(name.toLowerCase())) continue;
    const gh = diff.github_models.find(
      (m) => m.name.toLowerCase() === name.toLowerCase(),
    );
    additions.push({
      name: gh?.name ?? name,
      providers_opencode: gh ? [gh.provider] : [],
      sdk: "openai_compatible",
      variants: ["high"] as Variant[],
      slug_or: null,
      slug_oa_by_variant: {},
      status: "stub",
      detected_at: new Date().toISOString().slice(0, 10),
    });
    existingNames.add(name.toLowerCase());
    changed = true;
  }

  for (const name of diff.removed) {
    const idx = additions.findIndex(
      (a) => a.name.toLowerCase() === name.toLowerCase(),
    );
    if (idx >= 0) {
      additions[idx].status = "removed";
    } else {
      additions.push({
        name,
        providers_opencode: [],
        sdk: "openai_compatible",
        variants: ["high"] as Variant[],
        slug_or: null,
        slug_oa_by_variant: {},
        status: "removed",
        detected_at: new Date().toISOString().slice(0, 10),
      });
    }
    changed = true;
  }

  if (changed && !dryRun) {
    await fs.writeFile(ADDITIONS_PATH, JSON.stringify(additions, null, 2) + "\n");
  }
}
