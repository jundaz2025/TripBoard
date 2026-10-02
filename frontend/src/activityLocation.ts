// Activity pins do not require a Saved place. Legacy address lookups stay local until the user edits/saves.
import type { Activity, MapLocation, Place } from "./types";
export type LocatedActivities = Record<string, { address: string; coordinates: MapLocation }>;
export const activityMapId = (activity: Activity) => activity.place_id || `activity:${activity.id}`;

export function activityCoordinates(activity: Activity, places: Place[], located: LocatedActivities = {}): MapLocation | null {
  const saved = activity.place_id ? places.find(place => place.id === activity.place_id) : null;
  const cached = located[activity.id];
  const point = saved || activity.map_location || (cached && cached.address === activity.location ? cached.coordinates : null);
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? { lat: point.lat, lon: point.lon } : null;
}
