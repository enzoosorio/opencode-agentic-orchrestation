import { recordEvent, type Signal } from "./db.ts";
import type { Features } from "../features/schema.ts";

export interface CaptureCtx {
  features: Features;
  model_name: string;
  variant: string;
}

export function captureSignal(
  ctx: CaptureCtx,
  signal: Signal,
  note?: string,
): void {
  recordEvent({ ...ctx, signal, note });
}

/** Convenience helpers used by the UI / API. */
export const capture = {
  accepted: (ctx: CaptureCtx) => captureSignal(ctx, "accepted"),
  switched: (ctx: CaptureCtx, to?: string) =>
    captureSignal(ctx, "switched", to ? `→ ${to}` : undefined),
  regenerated: (ctx: CaptureCtx) => captureSignal(ctx, "regenerated"),
  ratedUp: (ctx: CaptureCtx, note?: string) =>
    captureSignal(ctx, "rated_up", note),
  ratedDown: (ctx: CaptureCtx, note?: string) =>
    captureSignal(ctx, "rated_down", note),
  abandoned: (ctx: CaptureCtx) => captureSignal(ctx, "abandoned"),
  continued: (ctx: CaptureCtx) => captureSignal(ctx, "continued"),
};
