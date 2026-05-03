import type { Notifier, NotifyMessage } from "./types.ts";
import { formatPlain } from "./types.ts";

export class ResendEmailNotifier implements Notifier {
  readonly name = "email";
  constructor(
    private readonly apiKey: string,
    private readonly to: string,
    private readonly from = "onboarding@resend.dev",
  ) {}

  async send(msg: NotifyMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: this.to,
        subject: msg.title,
        text: formatPlain(msg),
      }),
    });
    if (!res.ok) {
      throw new Error(`resend ${res.status}: ${await res.text()}`);
    }
  }
}
