import { z } from "zod";

export const TaskType = z.enum([
  "coding",
  "debug",
  "refactor",
  "research",
  "writing",
  "reasoning",
  "summarization",
  "translation",
  "role_play",
  "conversation",
  "other",
]);
export type TaskType = z.infer<typeof TaskType>;

export const Domain = z.enum([
  "frontend",
  "backend",
  "data",
  "devops",
  "ml",
  "security",
  "general",
  "other",
]);
export type Domain = z.infer<typeof Domain>;

export const Complexity = z.enum(["low", "medium", "high"]);
export type Complexity = z.infer<typeof Complexity>;

export const SizeOut = z.enum(["short", "medium", "long"]);
export type SizeOut = z.infer<typeof SizeOut>;

export const Scope = z.enum([
  "single_function",
  "single_file",
  "multi_file",
  "project_wide",
]);
export type Scope = z.infer<typeof Scope>;

export const Lang = z
  .enum([
    "ts",
    "js",
    "py",
    "go",
    "rust",
    "java",
    "csharp",
    "cpp",
    "ruby",
    "php",
    "swift",
    "kotlin",
    "shell",
    "sql",
    "html",
    "css",
    "markdown",
    "other",
  ])
  .nullable();
export type Lang = z.infer<typeof Lang>;

export const Features = z.object({
  task_type: TaskType,
  domain: Domain,
  complexity: Complexity,
  size_in_tokens: z.number().int().nonnegative(),
  size_out_estimated: SizeOut,
  needs_tools: z.boolean(),
  lang: Lang,
  needs_long_context: z.boolean(),
  scope: Scope,
});
export type Features = z.infer<typeof Features>;

/** Conservative default returned when the classifier fails (so the pipeline never crashes). */
export const FALLBACK_FEATURES: Features = {
  task_type: "other",
  domain: "general",
  complexity: "medium",
  size_in_tokens: 0,
  size_out_estimated: "medium",
  needs_tools: false,
  lang: null,
  needs_long_context: false,
  scope: "single_function",
};
