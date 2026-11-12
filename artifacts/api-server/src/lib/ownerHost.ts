import type { Request } from "express";

/** Comma-separated hostnames/IPs that may serve the platform-owner console. */
export function ownerHosts(): string[] {
  const raw = process.env.OWNER_HOSTS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  // Local/dev defaults — production must set OWNER_HOSTS.
  return ["127.0.0.1", "localhost"];
}

export function requestHostname(req: Request): string {
  const forwarded = req.get("x-forwarded-host") || req.get("host") || "";
  return forwarded.split(",")[0]?.trim().toLowerCase().split(":")[0] || "";
}

/** Nginx sets X-Pharmxs-Surface: owner|public. Falls back to OWNER_HOSTS match. */
export function isOwnerSurface(req: Request): boolean {
  const surface = (req.get("x-pharmxs-surface") || "").trim().toLowerCase();
  if (surface === "owner") return true;
  if (surface === "public") return false;
  const host = requestHostname(req);
  return ownerHosts().includes(host);
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = (req.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export const PUBLIC_APP_URL = () =>
  (process.env.PUBLIC_APP_URL || "https://pharmxs.uz").replace(/\/$/, "");

export const OWNER_PUBLIC_URL = () =>
  (process.env.OWNER_PUBLIC_URL || `http://${ownerHosts()[0] || "127.0.0.1"}:9080`).replace(
    /\/$/,
    "",
  );
