"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { route, type RouteResult } from "@/lib/router/graph";
import type { ProfileEntry } from "@/lib/rag/build_profiles";
import { loadFeedbackStats } from "@/lib/feedback/db";

const PROFILES_PATH = path.resolve(process.cwd(), "src/lib/models/profiles.json");

let _profilesCache: ProfileEntry[] | null = null;
let _profilesMtime = 0;

async function loadProfiles(): Promise<ProfileEntry[]> {
  try {
    const stat = await fs.stat(PROFILES_PATH);
    if (_profilesCache && stat.mtimeMs === _profilesMtime) return _profilesCache;
    const raw = await fs.readFile(PROFILES_PATH, "utf8");
    _profilesCache = JSON.parse(raw) as ProfileEntry[];
    _profilesMtime = stat.mtimeMs;
    return _profilesCache;
  } catch {
    return [];
  }
}

export interface SuggestResponse {
  ok: boolean;
  result?: RouteResult;
  error?: string;
  profile_count: number;
}

export async function suggestModel(input: string): Promise<SuggestResponse> {
  if (!input.trim()) {
    return { ok: false, error: "empty input", profile_count: 0 };
  }
  try {
    const profiles = await loadProfiles();
    if (profiles.length === 0) {
      return {
        ok: false,
        error:
          "profiles.json is empty — run `npm run fetch:profiles` or trigger the GitHub Action",
        profile_count: 0,
      };
    }
    const feedback = loadFeedbackStats();
    const result = await route(input, profiles, feedback);
    return { ok: true, result, profile_count: profiles.length };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      profile_count: 0,
    };
  }
}
