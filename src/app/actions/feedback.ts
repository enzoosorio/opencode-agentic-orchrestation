"use server";

import { capture } from "@/lib/feedback/capture";
import type { Features } from "@/lib/features/schema";

export interface FeedbackPayload {
  features: Features;
  model_name: string;
  variant: string;
  signal:
    | "accepted"
    | "switched"
    | "regenerated"
    | "rated_up"
    | "rated_down"
    | "abandoned"
    | "continued";
  note?: string;
}

export async function recordFeedback(p: FeedbackPayload): Promise<{ ok: true }> {
  const ctx = {
    features: p.features,
    model_name: p.model_name,
    variant: p.variant,
  };
  switch (p.signal) {
    case "accepted":
      capture.accepted(ctx);
      break;
    case "switched":
      capture.switched(ctx, p.note);
      break;
    case "regenerated":
      capture.regenerated(ctx);
      break;
    case "rated_up":
      capture.ratedUp(ctx, p.note);
      break;
    case "rated_down":
      capture.ratedDown(ctx, p.note);
      break;
    case "abandoned":
      capture.abandoned(ctx);
      break;
    case "continued":
      capture.continued(ctx);
      break;
  }
  return { ok: true };
}
