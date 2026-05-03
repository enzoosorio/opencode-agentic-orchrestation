import type { Notifier, NotifyMessage } from "./types.ts";
import { TelegramNotifier } from "./telegram.ts";
import { DiscordNotifier } from "./discord.ts";
import { NtfyNotifier } from "./ntfy.ts";
import { ResendEmailNotifier } from "./email.ts";

class NoopNotifier implements Notifier {
  readonly name = "noop";
  async send(msg: NotifyMessage): Promise<void> {
    console.warn(
      `[notify:noop] no channel configured. Title="${msg.title}", lines=${msg.lines.length}`,
    );
  }
}

export function getNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const channel = (env.NOTIFY_CHANNEL ?? "telegram").toLowerCase();
  switch (channel) {
    case "telegram": {
      const token = env.TELEGRAM_BOT_TOKEN;
      const chatId = env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) return new NoopNotifier();
      return new TelegramNotifier(token, chatId);
    }
    case "discord": {
      const url = env.DISCORD_WEBHOOK_URL;
      if (!url) return new NoopNotifier();
      return new DiscordNotifier(url);
    }
    case "ntfy": {
      const topic = env.NTFY_TOPIC;
      if (!topic) return new NoopNotifier();
      return new NtfyNotifier(topic);
    }
    case "email": {
      const key = env.RESEND_API_KEY;
      const to = env.NOTIFY_EMAIL_TO;
      if (!key || !to) return new NoopNotifier();
      return new ResendEmailNotifier(key, to);
    }
    default:
      return new NoopNotifier();
  }
}

export type { Notifier, NotifyMessage };
