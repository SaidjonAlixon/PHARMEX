import { and, eq, gte, inArray, lt, ne, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { branchesTable, db } from "@workspace/db";

export type DataMode = "demo" | "live" | "empty";

export function moneyCents(value: string | number | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  const raw = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return 0n;
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  let cents = BigInt(match[2]) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= "5") cents += 1n;
  return cents * sign;
}

export function centsMoney(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function milliQuantity(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, "0")}`;
}

export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (2n * d);
  return negative ? -rounded : rounded;
}

/** VAT already included in a gross amount at `rate` percent. */
export function includedVatCents(grossCents: bigint, rate: string | number): bigint {
  const rateBp = BigInt(Math.round(toNumber(rate) * 100));
  if (rateBp <= 0n) return 0n;
  return divideRounded(grossCents * rateBp, 10000n + rateBp);
}

export function quantityMilli(value: string | number): bigint {
  const raw = typeof value === "number" ? value.toFixed(3) : String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return 0n;
  const fraction = match[3] ?? "";
  const units =
    BigInt(match[2]) * 1000n + BigInt((fraction + "000").slice(0, 3));
  return match[1] === "-" ? -units : units;
}

export function extendedMoney(
  unitPrice: string | null | undefined,
  quantity: string | number,
): bigint {
  const product = moneyCents(unitPrice) * quantityMilli(quantity);
  const magnitude = product < 0n ? -product : product;
  const rounded = (magnitude + 500n) / 1000n;
  return product < 0n ? -rounded : rounded;
}

export function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dateConditions(
  column: AnyPgColumn,
  dateFrom?: Date,
  dateTo?: Date,
): SQL | undefined {
  const exclusiveEnd = dateTo
    ? new Date(dateTo.getTime() + 24 * 60 * 60 * 1000)
    : undefined;
  return and(
    dateFrom ? gte(column, dateFrom) : undefined,
    exclusiveEnd ? lt(column, exclusiveEnd) : undefined,
  );
}

export async function getDataMode(): Promise<DataMode> {
  const branches = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.source, "fom"))
    .limit(1);
  if (branches.length > 0) return "live";

  const seeded = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.source, "demo"))
    .limit(1);
  if (seeded.length > 0) return "demo";

  const manual = await db.select({ id: branchesTable.id }).from(branchesTable).limit(1);
  return manual.length > 0 ? "live" : "empty";
}

export function sourceCondition(
  column: AnyPgColumn,
  mode: DataMode,
): SQL {
  if (mode === "demo") return inArray(column, ["demo", "manual"]);
  if (mode === "live") return ne(column, "demo");
  return eq(column, "__no_records__");
}

export function combineConditions(
  ...conditions: Array<SQL | undefined>
): SQL | undefined {
  return and(...conditions);
}

export function dateOnly(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}
