// Nexus Channels — Telegram Plugin
import { Effect, Context } from "effect";

export interface TelegramConfig {
  token: string;
  allowedUsers?: string[];
  prefix?: string;
}

export interface TelegramMessage {
  updateId: number;
  chatId: number;
  text: string;
  username?: string;
  firstName?: string;
}

export interface TelegramChannel {
  readonly sendMessage: (chatId: number, text: string) => Effect.Effect<void, Error>;
  readonly getUpdates: (offset?: number) => Effect.Effect<TelegramMessage[], Error>;
}

export const TelegramChannel = Context.GenericTag<TelegramChannel>("TelegramChannel");

const TG_API = "https://api.telegram.org";

async function tgRequest(method: string, token: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `${TG_API}/bot${token}/${method}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json() as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`Telegram API error: ${json.description}`);
  return json.result;
}

export function makeTelegramChannel(config: TelegramConfig): TelegramChannel {
  const { token } = config;
  return {
    sendMessage(chatId, text) {
      return Effect.tryPromise({
        try: () => tgRequest("sendMessage", token, { chat_id: chatId, text }),
        catch: (e) => e as Error,
      });
    },
    getUpdates(offset = 0) {
      return Effect.tryPromise({
        try: async () => {
          const result = await tgRequest("getUpdates", token, {
            offset,
            timeout: 30,
            allowed_updates: ["message"],
          }) as Array<{
            update_id: number;
            message?: { chat: { id: number }; text?: string; from?: { username?: string; first_name?: string } };
          }>;
          return result.filter(u => u.message).map(u => ({
            updateId: u.update_id,
            chatId: u.message!.chat.id,
            text: u.message!.text || "",
            username: u.message!.from?.username,
            firstName: u.message!.from?.first_name,
          }));
        },
        catch: (e) => e as Error,
      });
    },
  };
}
