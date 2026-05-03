import type { Notifier, NotifyMessage } from "./types.ts";
import { formatPlain } from "./types.ts";

export class NtfyNotifier implements Notifier {
  readonly name = "ntfy";
  constructor(private readonly topic: string) {}

  async send(msg: NotifyMessage): Promise<void> {
    const url = `https://ntfy.sh/${this.topic}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Title: msg.title },
      body: formatPlain(msg),
    });
    if (!res.ok) {
      throw new Error(`ntfy ${res.status}: ${await res.text()}`);
    }
  }
}
