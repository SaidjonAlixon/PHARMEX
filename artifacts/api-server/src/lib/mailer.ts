import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

export type MailMessage = { to: string; subject: string; text: string; html: string };

function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, "");
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT) || 465,
    user,
    pass,
    from: process.env.SMTP_FROM?.trim() || user,
    fromName: process.env.SMTP_FROM_NAME?.trim() || "PHARMEX",
  };
}

export function mailConfigured(): boolean {
  return smtpConfig() !== null;
}

// Without SMTP the code is written to the server log so the flow can be tested locally; never in production.
export function mailDevFallback(): boolean {
  return !mailConfigured() && process.env.NODE_ENV !== "production";
}

const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, (line) => `${line}\r\n`);

function buildMessage(cfg: SmtpConfig, msg: MailMessage): string {
  const boundary = `px-${randomBytes(12).toString("hex")}`;
  const domain = cfg.from.split("@")[1] || "pharmex.local";
  const lines = [
    `From: ${encodeHeader(cfg.fromName)} <${cfg.from}>`,
    `To: <${msg.to}>`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(msg.text).toString("base64")),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(msg.html).toString("base64")),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

class SmtpSession {
  private buffer = "";
  private waiters: Array<(line: string) => void> = [];
  private failure: Error | null = null;

  constructor(private socket: net.Socket) {
    this.attach(socket);
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new Error("SMTP ulanish yopildi")));
  }

  private fail(err: Error) {
    if (this.failure) return;
    this.failure = err;
    for (const w of this.waiters.splice(0)) w("");
  }

  private flush() {
    // A reply is complete when a line has a space (not a dash) after the 3-digit code.
    const match = this.buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*\d{3}(?: [^\r\n]*)?\r\n/);
    if (!match || !this.waiters.length) return;
    this.buffer = this.buffer.slice(match[0].length);
    this.waiters.shift()!(match[0]);
    this.flush();
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.waiters.push((reply) => (this.failure ? reject(this.failure) : resolve(reply)));
      this.flush();
    });
  }

  async expect(codes: number[], command?: string, label = command?.split(/[ :]/)[0] ?? "greeting"): Promise<string> {
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const reply = await this.read();
    const code = Number(reply.slice(0, 3));
    if (!codes.includes(code)) {
      throw new Error(`SMTP ${label}: ${reply.trim().split("\r\n").pop()}`);
    }
    return reply;
  }

  upgrade(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("close");
      this.socket.removeAllListeners("error");
      const secure = tls.connect({ socket: this.socket, servername: host }, () => resolve());
      secure.once("error", reject);
      this.attach(secure);
    });
  }

  end() {
    this.socket.end();
  }
}

function connect(cfg: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const options = { host: cfg.host, port: cfg.port, servername: cfg.host };
    const socket =
      cfg.port === 465 ? tls.connect(options, () => resolve(socket)) : net.connect(options, () => resolve(socket));
    socket.setTimeout(20_000, () => socket.destroy(new Error("SMTP server javob bermadi (timeout)")));
    socket.once("error", reject);
  });
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const cfg = smtpConfig();
  if (!cfg) {
    if (mailDevFallback()) {
      logger.warn({ to: msg.to, subject: msg.subject, text: msg.text }, "SMTP sozlanmagan — xat faqat logga yozildi (dev)");
      return;
    }
    throw new Error("Email yuborish sozlanmagan (SMTP_HOST, SMTP_USER, SMTP_PASS).");
  }

  const session = new SmtpSession(await connect(cfg));
  const helo = "pharmex.local";
  try {
    await session.expect([220]);
    let ehlo = await session.expect([250], `EHLO ${helo}`);
    if (cfg.port !== 465) {
      if (!/STARTTLS/i.test(ehlo)) throw new Error("SMTP server STARTTLS ni qoʻllamaydi");
      await session.expect([220], "STARTTLS");
      await session.upgrade(cfg.host);
      ehlo = await session.expect([250], `EHLO ${helo}`);
    }
    await session.expect([334], "AUTH LOGIN");
    await session.expect([334], Buffer.from(cfg.user).toString("base64"), "AUTH");
    await session.expect([235], Buffer.from(cfg.pass).toString("base64"), "AUTH").catch(() => {
      throw new Error("SMTP login yoki parol (App Password) notoʻgʻri");
    });
    await session.expect([250], `MAIL FROM:<${cfg.from}>`);
    await session.expect([250, 251], `RCPT TO:<${msg.to}>`);
    await session.expect([354], "DATA");
    const body = buildMessage(cfg, msg).replace(/^\./gm, "..");
    await session.expect([250], `${body}\r\n.`, "DATA");
    await session.expect([221], "QUIT").catch(() => undefined);
  } finally {
    session.end();
  }
}
