export interface NotifyMessage {
  title: string;
  lines: string[];
}

export interface Notifier {
  readonly name: string;
  send(msg: NotifyMessage): Promise<void>;
}

export function formatPlain(msg: NotifyMessage): string {
  return [msg.title, ...msg.lines].join("\n");
}
