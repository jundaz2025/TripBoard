// Formats friendly time-zone labels while retaining IANA IDs for storage and daylight-saving calculations.
import { getLocale, tr } from "./i18n";

const labels = new Map<string, string>();

// Generic names stay readable throughout the year; the original ID is kept for
// date calculations, including each region's daylight-saving rules.
export function timeZoneLabel(zone?: string | null): string {
  if (!zone) return "";
  const key = getLocale() + ":" + zone;
  const cached = labels.get(key);
  if (cached) return cached;
  let label: string;
  try {
    label = new Intl.DateTimeFormat(getLocale(), {
      timeZone: zone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date("2026-01-01T12:00:00Z"))
      .find(part => part.type === "timeZoneName")?.value ?? tr("Local time");
  } catch {
    label = tr("Time zone unavailable");
  }
  labels.set(key, label);
  return label;
}

// Existing reminders contain IANA IDs in their text. Format them on display so
// past reminders benefit too, without rewriting stored messages.
export function humanizeTimeZones(text: string): string {
  return text.replace(/\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*\b/g, zone => timeZoneLabel(zone));
}

export function timeZoneOptionLabel(zone: string): string {
  const city = zone.split("/").at(-1)?.replaceAll("_", " ");
  return zone.includes("/") && !zone.startsWith("Etc/")
    ? `${timeZoneLabel(zone)} — ${city}`
    : timeZoneLabel(zone);
}

export const getTimeZoneOptions = () => [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])]
  .map(value => ({ value, label: timeZoneOptionLabel(value) }))
  .sort((a, b) => a.label.localeCompare(b.label, getLocale()));
