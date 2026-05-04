import { promises as fs } from "node:fs";
import path from "node:path";

export type ScrapeAction =
  | "none"
  | "scrapped"
  | "model_added"
  | "model_removed"
  | "manual_added"
  | "error";

export interface ScrapeLogEntry {
  url: string;
  action: ScrapeAction;
  detail: string;
  ts: string; // ISO datetime e.g. "2026-05-04 13:42:07"
}

export class ScrapeLog {
  private entries: ScrapeLogEntry[] = [];

  add(entry: Omit<ScrapeLogEntry, "ts">): void {
    this.entries.push({
      ...entry,
      ts: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
  }

  get all(): ScrapeLogEntry[] {
    return this.entries;
  }

  countByAction(): Record<ScrapeAction, number> {
    const counts: Record<ScrapeAction, number> = {
      none: 0,
      scrapped: 0,
      model_added: 0,
      model_removed: 0,
      manual_added: 0,
      error: 0,
    };
    for (const e of this.entries) counts[e.action]++;
    return counts;
  }

  toMarkdownSection(date: string): string {
    const lines: string[] = [];
    lines.push(`## ${date}`);
    lines.push(`| Timestamp | URL | Acción | Detalle |`);
    lines.push(`|---|---|---|---|`);
    for (const e of this.entries) {
      const detail = e.detail.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${e.ts} | ${e.url} | ${e.action} | ${detail} |`);
    }
    lines.push("");
    return lines.join("\n");
  }

  async appendToFile(filePath: string, date: string): Promise<void> {
    const section = this.toMarkdownSection(date);
    let header = "";
    try {
      await fs.access(filePath);
    } catch {
      header = "# Scrape log\n\nAppend-only registry of URLs visited by the static RAG fetcher.\n\n";
    }
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    if (header) await fs.writeFile(filePath, header);
    // Prepend the new section after the header so most recent appears first.
    const existing = await fs.readFile(filePath, "utf8").catch(() => "");
    const headerEnd = existing.indexOf("\n## ");
    if (headerEnd === -1) {
      await fs.writeFile(filePath, existing + "\n" + section);
    } else {
      const before = existing.slice(0, headerEnd + 1);
      const after = existing.slice(headerEnd + 1);
      await fs.writeFile(filePath, before + section + "\n" + after);
    }
  }
}
