import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { classify, type ClassifyResult } from "../classifier/extract.ts";
import { rank, type RankedModel, type FeedbackStat } from "./rank.ts";
import type { Features } from "../features/schema.ts";
import type { ProfileEntry } from "../rag/build_profiles.ts";

export const RouterState = Annotation.Root({
  input: Annotation<string>,
  profiles: Annotation<ProfileEntry[]>,
  feedback: Annotation<FeedbackStat[]>,
  features: Annotation<Features | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  classifier_meta: Annotation<{
    cached: boolean;
    model: string;
    duration_ms: number;
  } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  ranked: Annotation<RankedModel[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

export type RouterStateT = typeof RouterState.State;

async function classifierNode(
  state: RouterStateT,
): Promise<Partial<RouterStateT>> {
  const res: ClassifyResult = await classify(state.input);
  return {
    features: res.features,
    classifier_meta: {
      cached: res.cached,
      model: res.model,
      duration_ms: res.duration_ms,
    },
  };
}

async function rankerNode(
  state: RouterStateT,
): Promise<Partial<RouterStateT>> {
  if (!state.features) return { ranked: [] };
  const ranked = rank(state.features, state.profiles, state.feedback);
  return { ranked };
}

export function buildRouterGraph() {
  return new StateGraph(RouterState)
    .addNode("classifier", classifierNode)
    .addNode("ranker", rankerNode)
    .addEdge(START, "classifier")
    .addEdge("classifier", "ranker")
    .addEdge("ranker", END)
    .compile();
}

export type CompiledRouter = ReturnType<typeof buildRouterGraph>;

export interface RouteResult {
  features: Features | null;
  ranked: RankedModel[];
  classifier_meta: RouterStateT["classifier_meta"];
}

export async function route(
  input: string,
  profiles: ProfileEntry[],
  feedback: FeedbackStat[] = [],
): Promise<RouteResult> {
  const graph = buildRouterGraph();
  const final = await graph.invoke({ input, profiles, feedback });
  return {
    features: final.features,
    ranked: final.ranked,
    classifier_meta: final.classifier_meta,
  };
}
