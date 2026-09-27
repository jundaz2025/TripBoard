// Formats journey times for display and determines which trip-local days a cross-zone journey touches.
import { getLocale } from "./i18n";
import type { Transport } from "./types";
export const transportModes = { flight: "Flight", driving: "Driving", train: "Train", bus: "Bus", ferry: "Ferry", other: "Other" };
export function dateTimeLabel(value: string, zone: string) {
  return new Date(value).toLocaleString(getLocale(), {
    timeZone: zone, year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
function dateInZone(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)?.value).join("-");
}
export function transportOnDay(leg: Transport, day: string, zone: string) {
  return dateInZone(leg.departure_at, zone) <= day && dateInZone(new Date(new Date(leg.arrival_at).getTime() - 1).toISOString(), zone) >= day;
}
