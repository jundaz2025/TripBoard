// Shared HTTP boundary and date presentation helpers. Payload values stay independent of the interface language.
import { getLocale, getLanguage, tr } from "./i18n";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  version?: number,
): Promise<T> {
  // Let the browser set multipart boundaries for uploads; only ordinary payloads become JSON.
  const headers: Record<string, string> = {};
  if (data !== undefined && !(data instanceof FormData))
    headers["Content-Type"] = "application/json";
  // If-Match carries the version the user edited, not whichever version arrived most recently.
  if (version !== undefined) headers["If-Match"] = String(version);
  const response = await fetch("/api" + path, {
    method,
    headers,
    credentials: "same-origin",
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  // Empty successful responses and non-JSON failures must not fail while parsing the error itself.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(
                (e: { msg: string; loc: string[] }) =>
                  `${e.loc.slice(1).join(".")}: ${e.msg}`,
              )
              .join("; ")
          : `Request failed (${response.status}).`,
      response.status,
    );
  }
  return body as T;
}
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
// Calendar days use UTC noon to avoid browser-local midnight offsets and DST day-length changes.
export function days(start: string, end: string) {
  const result: string[] = [];
  for (
    let d = new Date(start + "T12:00:00Z");
    d <= new Date(end + "T12:00:00Z") && result.length < 62;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    result.push(d.toISOString().slice(0, 10));
  return result;
}
export const dateLabel = (s: string, long = false) =>
  new Date(s + "T12:00:00Z").toLocaleDateString(getLocale(), {
    timeZone: "UTC",
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { weekday: "long" as const } : {}),
  });
export const endTime = (start: string, duration: number) => {
  const [h, m] = start.split(":").map(Number);
  const value = h * 60 + m + duration;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

export function clockLabel(value?: string | null) {
  if (!value) return tr("Time not set");
  if (getLanguage() === "zh") return value.slice(0, 5);
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}
