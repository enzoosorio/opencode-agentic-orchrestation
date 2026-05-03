"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { suggestModel, type SuggestResponse } from "./actions/route";
import { recordFeedback } from "./actions/feedback";

type Stage = "idle" | "classifying" | "ranking" | "done" | "error";

interface SessionPick {
  model_name: string;
  variant: string;
  features: NonNullable<SuggestResponse["result"]>["features"];
}

export function TuiClient() {
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [resp, setResp] = useState<SuggestResponse | null>(null);
  const [activePick, setActivePick] = useState<SessionPick | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    if (!input.trim() || stage === "classifying" || stage === "ranking") return;
    setStage("classifying");
    setResp(null);
    setActivePick(null);
    // Stage transition happens client-side as optimistic feedback;
    // the server action does both classifier + ranker in one call.
    setTimeout(() => setStage("ranking"), 250);
    const r = await suggestModel(input);
    setResp(r);
    setStage(r.ok ? "done" : "error");
  }, [input, stage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const pick = useCallback(
    async (
      idx: number,
      signal: "accepted" | "switched",
    ) => {
      if (!resp?.ok || !resp.result?.features) return;
      const ranked = resp.result.ranked[idx];
      if (!ranked) return;
      const ctx = {
        features: resp.result.features,
        model_name: ranked.model_name,
        variant: ranked.variant,
      };
      setActivePick(ctx);
      await recordFeedback({ ...ctx, signal });
    },
    [resp],
  );

  const rate = useCallback(
    async (signal: "rated_up" | "rated_down") => {
      if (!activePick) return;
      await recordFeedback({ ...activePick, signal });
    },
    [activePick],
  );

  const features = resp?.result?.features ?? null;
  const meta = resp?.result?.classifier_meta ?? null;
  const ranked = resp?.result?.ranked ?? [];

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "2rem 1rem",
      }}
    >
      <header style={{ marginBottom: "1rem" }}>
        <div className="muted">
          $ opencode-router{" "}
          <span className="accent">— {resp?.profile_count ?? 0}</span> profiles
          loaded
        </div>
        <h1 style={{ fontSize: "1.05rem", margin: ".5rem 0 0" }}>
          Static + dynamic model routing for opencode plan GO
        </h1>
      </header>

      <section>
        <label className="muted" htmlFor="prompt">
          {">"} input (ctrl+enter to submit)
        </label>
        <textarea
          id="prompt"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={6}
          placeholder='e.g. "implementa SEO a todo el proyecto" or paste a long prompt...'
          style={{ width: "100%", marginTop: ".25rem" }}
        />
        <div style={{ marginTop: ".5rem", display: "flex", gap: ".5rem" }}>
          <button onClick={submit} disabled={!input.trim()}>
            route ⏎
          </button>
          {stage !== "idle" && (
            <span className="muted">
              [stage] {stage}
              {meta?.cached ? " (cached)" : ""}
              {meta ? ` · ${meta.duration_ms}ms · ${meta.model}` : ""}
            </span>
          )}
        </div>
      </section>

      {stage === "error" && resp?.error && (
        <pre className="err" style={{ marginTop: "1rem" }}>
          {`error: ${resp.error}`}
        </pre>
      )}

      {features && (
        <section style={{ marginTop: "1.5rem" }}>
          <div className="muted">{"# features"}</div>
          <pre style={{ margin: ".25rem 0", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(features, null, 2)}
          </pre>
        </section>
      )}

      {ranked.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <div className="muted">{"# top-3 recommendations"}</div>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: ".5rem",
              display: "grid",
              gap: ".5rem",
            }}
          >
            {ranked.map((r, i) => {
              const isPicked =
                activePick?.model_name === r.model_name &&
                activePick.variant === r.variant;
              return (
                <li
                  key={`${r.model_name}|${r.variant}`}
                  style={{
                    border: `1px solid ${isPicked ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 4,
                    padding: ".75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                    }}
                  >
                    <strong>
                      [{i + 1}] {r.model_name}{" "}
                      <span className="muted">({r.variant})</span>
                    </strong>
                    <span className="muted">score {r.score.toFixed(2)}</span>
                  </div>
                  <div className="muted" style={{ marginTop: ".25rem" }}>
                    {r.reasons.join(" · ")}
                  </div>
                  <div
                    style={{
                      marginTop: ".5rem",
                      display: "flex",
                      gap: ".5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <button onClick={() => pick(i, "accepted")}>
                      use this
                    </button>
                    {!isPicked && (
                      <button onClick={() => pick(i, "switched")}>
                        switch to this
                      </button>
                    )}
                    {isPicked && (
                      <>
                        <button onClick={() => rate("rated_up")}>👍</button>
                        <button onClick={() => rate("rated_down")}>👎</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <footer style={{ marginTop: "2rem" }} className="muted">
        feedback en{" "}
        <code>{process.env.NEXT_PUBLIC_FEEDBACK_DB_PATH ?? "./data/feedback.db"}</code>{" "}
        · shadow mode hasta acumular {process.env.NEXT_PUBLIC_FEEDBACK_SHADOW_THRESHOLD ?? 50}{" "}
        muestras por combo (task_type × domain × complexity)
      </footer>
    </main>
  );
}
