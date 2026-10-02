// Builds one provider-independent map model so Google Maps and MapLibre use identical day colors and routes.
import { tr, getLocale } from "./i18n";
import { days } from "./api";
import type { FeatureCollection, LineString } from "geojson";
import type { Trip } from "./types";
import type { LocationResult } from "./locations";
import { activityCoordinates, activityMapId } from "./activityLocation";
import type { LocatedActivities } from "./activityLocation";

// Keep the first twelve day colors fixed; longer trips use generated hues.
const DAY_COLORS = [
  "#d94c46", // Red
  "#2563eb", // Blue
  "#8b5cf6", // Violet
  "#008577", // Teal
  "#b45309", // Orange
  "#be185d", // Pink
  "#4f46e5", // Indigo
  "#477c17", // Green
  "#0891b2", // Cyan
  "#795548", // Brown
  "#a18a00", // Mustard
  "#a95d79", // Dusty rose
];
export const SAVED_COLOR = "#64748b";
export const HOTEL_COLOR = "#99712c";
export const SEARCH_COLOR = "#d94c46";

export function mapDayInfo(day: string, start: string) {
  const index = Math.max(0, Math.round((Date.parse(day + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86_400_000));
  const date = new Date(day + "T12:00:00Z").toLocaleDateString(getLocale(), { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    day, number: index + 1, label: tr("Day {number} · {date}", {number: index + 1, date}),
    color: DAY_COLORS[index] ?? `hsl(${((index * 137.508 + 15) % 360).toFixed(1)}, 65%, 40%)`,
  };
}
type MapDay = ReturnType<typeof mapDayInfo>;
export type MapPoint = {
  id: string; name: string; lat: number; lon: number;
  kind: "place" | "activity" | "hotel" | "search";
  color: string; colors: string[]; text: string; description: string; active: boolean;
};
type Visit = MapDay & { order: number };
export type MapPlan = ReturnType<typeof buildMapPlan>;

export function buildMapPlan(trip: Trip, day: string, preview?: LocationResult | null, located: LocatedActivities = {}) {
  const selectedDay = day && day >= trip.start_date && day <= trip.end_date ? day : trip.start_date;
  const groups = new Map<string, { info: MapDay; coordinates: [number, number][] }>();
  const locations = new Map<string, { id: string; title: string; lat: number; lon: number; kind: "place" | "activity" }>(
    trip.places.map(place => [place.id, { ...place, kind: "place" }]),
  );
  const visits = new Map<string, Visit[]>();
  const orders = new Map<string, number>();
  // Group before drawing: each line contains coordinates from exactly one day.
  for (const activity of [...trip.activities].sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start))) {
    // Out-of-range activities remain recoverable in the itinerary review, never masquerade as Day 1.
    if (activity.day < trip.start_date || activity.day > trip.end_date) continue;
    const order = (orders.get(activity.day) ?? 0) + 1;
    orders.set(activity.day, order);
    const coordinates = activityCoordinates(activity, trip.places, located);
    if (!coordinates) continue;
    const pointId = activityMapId(activity);
    // Unbookmarked activities get their own day-colored pin and participate in that day's route.
    if (!locations.has(pointId)) locations.set(pointId, {
      id: pointId, title: activity.title, ...coordinates, kind: "activity",
    });
    const info = mapDayInfo(activity.day, trip.start_date);
    const group = groups.get(activity.day) ?? { info, coordinates: [] };
    group.coordinates.push([coordinates.lon, coordinates.lat]);
    groups.set(activity.day, group);
    const entries = visits.get(pointId) ?? [];
    entries.push({ ...info, order });
    visits.set(pointId, entries);
  }
  // One pin can represent several visits: its ring records all day colors, its number follows the selected day.
  const points: MapPoint[] = [...locations.values()].map(place => {
    const entries = visits.get(place.id) ?? [];
    const visit = entries.find(entry => entry.day === selectedDay) ?? entries[0];
    const colors = [...new Set(entries.map(entry => entry.color))];
    const active = entries.some(entry => entry.day === selectedDay);
    return {
      id: place.id, name: place.title, lat: place.lat, lon: place.lon, kind: place.kind,
      color: visit?.color ?? SAVED_COLOR, colors, active,
      text: active ? String(visit.order) : visit ? `D${visit.number}${colors.length > 1 ? "+" : ""}` : "•",
      description: `${place.title} — ${entries.length ? entries.map(entry => tr("{day}, stop {order}", {day: entry.label, order: entry.order})).join("; ") : tr("Saved place · not scheduled")}`,
    };
  });
  points.push(...trip.hotels.map(hotel => ({
    id: hotel.id, name: hotel.name, lat: hotel.lat, lon: hotel.lon, kind: "hotel" as const,
    color: HOTEL_COLOR, colors: [], text: "H", description: `${hotel.name} — ${tr("Hotel")}`, active: false,
  })));
  if (preview) points.push({
    id: "search-preview", name: preview.name, lat: preview.lat, lon: preview.lon, kind: "search",
    color: SEARCH_COLOR, colors: [], text: "⌖", description: `${preview.name} — ${tr("Search result")}`, active: false,
  });
  const routes = [...groups.values()]
    .filter(group => group.coordinates.length > 1)
    .map(group => ({ ...group.info, coordinates: group.coordinates, active: group.info.day === selectedDay }))
    .sort((a, b) => Number(a.active) - Number(b.active));
  // Navigation follows the trip calendar, not the subset of activities with map coordinates.
  // Empty or unmapped days must stay clickable after the user selects a different day.
  const dayInfo = days(trip.start_date, trip.end_date).map(date => mapDayInfo(date, trip.start_date));
  return {
    points, routes, selectedDay,
    days: dayInfo,
    hasSelectedActivities: groups.has(selectedDay),
    hasScheduled: groups.size > 0,
    hasUnscheduled: points.some(point => point.kind === "place" && !point.colors.length),
    hasHotels: trip.hotels.length > 0,
    hasShared: points.some(point => point.colors.length > 1),
  };
}

export function mapRouteData(plan: MapPlan): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: plan.routes.map(route => ({
      type: "Feature", properties: { day: route.day, color: route.color, opacity: route.active ? 0.95 : 0.35, width: route.active ? 3.5 : 2 },
      geometry: { type: "LineString", coordinates: route.coordinates },
    })),
  };
}
