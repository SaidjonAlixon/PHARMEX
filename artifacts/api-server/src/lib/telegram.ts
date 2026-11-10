import { logger } from "./logger";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "Telegram send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Telegram send error");
    return false;
  }
}

export async function notifyOrgTelegram(
  chatId: string | null | undefined,
  enabled: boolean,
  text: string,
): Promise<void> {
  if (!enabled || !chatId) return;
  await sendTelegram(chatId, text);
}
