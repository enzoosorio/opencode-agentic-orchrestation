import { OPENCODE_GO_CATALOG } from "../models/opencode_go_catalog.ts";

const ZEN_URL = "https://opencode.ai/zen/go/v1/models";
const GH_RAW =
  "https://raw.githubusercontent.com/sst/opencode/main/packages/console/app/src/routes/go/index.tsx";

export interface CatalogDiff {
  added: string[];
  removed: string[];
  zen_models: string[];
  github_models: Array<{ name: string; provider: string }>;
  errors: string[];
}

interface ZenModel {
  id?: string;
  name?: string;
}

async function fetchZen(): Promise<string[]> {
  const res = await fetch(ZEN_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`zen ${res.status}`);
  const json = (await res.json()) as { models?: ZenModel[] } | ZenModel[];
  const arr = Array.isArray(json) ? json : (json.models ?? []);
  return arr
    .map((m) => m.name ?? m.id ?? "")
    .filter(Boolean);
}

async function fetchGithubModels(): Promise<Array<{ name: string; provider: string }>> {
  const res = await fetch(GH_RAW);
  if (!res.ok) throw new Error(`github raw ${res.status}`);
  const text = await res.text();
  const out: Array<{ name: string; provider: string }> = [];
  // match { name: "...", provider: "..." }
  const re = /\{\s*name:\s*"([^"]+)"\s*,\s*provider:\s*"([^"]+)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], provider: m[2] });
  }
  return out;
}

export async function checkOpencodeCatalog(): Promise<CatalogDiff> {
  const errors: string[] = [];
  let zen_models: string[] = [];
  let github_models: Array<{ name: string; provider: string }> = [];

  try {
    zen_models = await fetchZen();
  } catch (err) {
    errors.push(`zen fetch: ${(err as Error).message}`);
  }
  try {
    github_models = await fetchGithubModels();
  } catch (err) {
    errors.push(`github raw fetch: ${(err as Error).message}`);
  }

  const localNames = new Set(OPENCODE_GO_CATALOG.map((c) => c.name.toLowerCase()));
  const remoteNames = new Set(
    [
      ...zen_models.map((s) => s.toLowerCase()),
      ...github_models.map((g) => g.name.toLowerCase()),
    ],
  );

  const added: string[] = [];
  for (const r of remoteNames) if (!localNames.has(r)) added.push(r);

  const removed: string[] = [];
  if (remoteNames.size > 0) {
    for (const l of localNames) if (!remoteNames.has(l)) removed.push(l);
  }

  return { added, removed, zen_models, github_models, errors };
}
