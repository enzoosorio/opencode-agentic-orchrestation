import type { Notifier, NotifyMessage } from "./types.ts";
import { formatPlain } from "./types.ts";

export class DiscordNotifier implements Notifier {
  readonly name = "discord";
  constructor(private readonly webhookUrl: string) {}

  async send(msg: NotifyMessage): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: formatPlain(msg) }),
    });
    if (!res.ok) {
      throw new Error(`discord webhook ${res.status}: ${await res.text()}`);
    }
  }
}
