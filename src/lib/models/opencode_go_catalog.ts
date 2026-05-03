export type SdkType = "openai_compatible" | "anthropic" | "alibaba";
export type Variant =
  | "non-reasoning"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface CatalogEntry {
  name: string;
  providers_opencode: string[];
  sdk: SdkType;
  variants: Variant[];
  slug_or: string | null;
  slug_oa_by_variant: Partial<Record<Variant, string>>;
}

export const VARIANTS_BY_SDK: Record<SdkType, Variant[]> = {
  openai_compatible: ["low", "medium", "high"],
  anthropic: ["high", "max"],
  alibaba: ["low", "high"],
};

export const OPENCODE_GO_CATALOG: CatalogEntry[] = [
  {
    name: "GLM-5.1",
    providers_opencode: ["DeepInfra", "Fireworks AI", "Z.ai"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "z-ai/glm-5.1",
    slug_oa_by_variant: { high: "glm-5-1" },
  },
  {
    name: "GLM-5",
    providers_opencode: ["DeepInfra", "Fireworks AI", "Z.ai"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "z-ai/glm-5",
    slug_oa_by_variant: { high: "glm-5" },
  },
  {
    name: "Kimi K2.5",
    providers_opencode: ["Moonshot AI"],
    sdk: "openai_compatible",
    variants: ["high"],
    slug_or: "moonshotai/kimi-k2.5",
    slug_oa_by_variant: { high: "kimi-k2-5" },
  },
  {
    name: "Kimi K2.6",
    providers_opencode: ["Moonshot AI"],
    sdk: "openai_compatible",
    variants: ["high"],
    slug_or: "moonshotai/kimi-k2.6",
    slug_oa_by_variant: { high: "kimi-k2-6" },
  },
  {
    name: "MiMo-V2-Pro",
    providers_opencode: ["Xiaomi MiMo"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "xiaomi/mimo-v2-pro",
    slug_oa_by_variant: { high: "mimo-v2-pro" },
  },
  {
    name: "MiMo-V2-Omni",
    providers_opencode: ["Xiaomi MiMo"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "xiaomi/mimo-v2-omni",
    slug_oa_by_variant: { high: "mimo-v2-omni" },
  },
  {
    name: "MiMo-V2.5-Pro",
    providers_opencode: ["Xiaomi MiMo"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "xiaomi/mimo-v2.5-pro",
    slug_oa_by_variant: { high: "mimo-v2-5-pro" },
  },
  {
    name: "MiMo-V2.5",
    providers_opencode: ["Xiaomi MiMo"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "xiaomi/mimo-v2.5",
    slug_oa_by_variant: { high: "mimo-v2-5" },
  },
  {
    name: "Qwen3.5 Plus",
    providers_opencode: ["Alibaba Cloud Model Studio"],
    sdk: "alibaba",
    variants: ["low", "high"],
    slug_or: null,
    slug_oa_by_variant: {},
  },
  {
    name: "Qwen3.6 Plus",
    providers_opencode: ["Alibaba Cloud Model Studio"],
    sdk: "alibaba",
    variants: ["low", "high"],
    slug_or: "qwen/qwen3.6-plus",
    slug_oa_by_variant: { high: "qwen3-6-plus" },
  },
  {
    name: "MiniMax M2.7",
    providers_opencode: ["MiniMax"],
    sdk: "anthropic",
    variants: ["high", "max"],
    slug_or: "minimax/minimax-m2.7",
    slug_oa_by_variant: { high: "minimax-m2-7", max: "minimax-m2-7-max" },
  },
  {
    name: "MiniMax M2.5",
    providers_opencode: ["MiniMax"],
    sdk: "anthropic",
    variants: ["high", "max"],
    slug_or: "minimax/minimax-m2.5",
    slug_oa_by_variant: { high: "minimax-m2-5" },
  },
  {
    name: "DeepSeek V4 Pro",
    providers_opencode: ["DeepSeek"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high", "max"],
    slug_or: "deepseek/deepseek-v4-pro",
    slug_oa_by_variant: {
      "non-reasoning": "deepseek-v4-pro-non-reasoning",
      high: "deepseek-v4-pro-high",
      max: "deepseek-v4-pro",
    },
  },
  {
    name: "DeepSeek V4 Flash",
    providers_opencode: ["DeepSeek"],
    sdk: "openai_compatible",
    variants: ["low", "medium", "high"],
    slug_or: "deepseek/deepseek-v4-flash",
    slug_oa_by_variant: { high: "deepseek-v4-flash" },
  },
];

export interface ResolvedTarget {
  catalog_index: number;
  name: string;
  variant: Variant;
  slug_or: string | null;
  slug_oa: string | null;
  providers_opencode: string[];
  sdk: SdkType;
}

export function expandTargets(
  catalog: CatalogEntry[] = OPENCODE_GO_CATALOG,
): ResolvedTarget[] {
  const out: ResolvedTarget[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    for (const variant of entry.variants) {
      out.push({
        catalog_index: i,
        name: entry.name,
        variant,
        slug_or: entry.slug_or,
        slug_oa: entry.slug_oa_by_variant[variant] ?? null,
        providers_opencode: entry.providers_opencode,
        sdk: entry.sdk,
      });
    }
  }
  return out;
}
