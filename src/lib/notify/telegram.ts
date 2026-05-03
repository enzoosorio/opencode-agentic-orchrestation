import type { Notifier, NotifyMessage } from "./types.ts";
import { formatPlain } from "./types.ts";

export class TelegramNotifier implements Notifier {
  readonly name = "telegram";
  constructor(
    private readonly token: string,
    private readonly chatId: string,
  ) {}

  async send(msg: NotifyMessage): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const text = formatPlain(msg);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `telegram sendMessage ${res.status}: ${await res.text()}`,
      );
    }
  }
}
