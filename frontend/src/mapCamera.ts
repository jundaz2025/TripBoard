// Camera intent is independent of React object identity and background snapshot updates.
import type { MapPlan } from "./mapPlan";
import type { LocationResult } from "./locations";
export type CameraTarget =
  | { kind: "point"; lat: number; lon: number; zoom: number }
  | { kind: "bounds"; coordinates: [number, number][]; maxZoom: number; padding: number }
  | { kind: "pending" };
export type CameraInput = {
  plan: MapPlan; tripId: string; city: string; selected: string | null;
  preview?: LocationResult | null; destination?: LocationResult | null;
  overview?: number;
  savedOverview?: number;
  focusRevision?: number;
};
export function cameraRequest({ plan, tripId, city, selected, preview, destination, overview = 0, savedOverview = 0, focusRevision = 0 }: CameraInput) {
  // An explicit day click is a new intent, while polling or translated labels keep the same key.
  const key = JSON.stringify([tripId, city, plan.selectedDay, selected, preview && [preview.lat, preview.lon], overview, savedOverview, focusRevision]);
  let target: CameraTarget;
  const focus = preview || plan.points.find(p => p.id === selected);
  if (focus) target = { kind: "point", lat: focus.lat, lon: focus.lon, zoom: 14 };
  else {
    const active = plan.points.filter(p => p.active);
    const scheduled = plan.points.filter(p => p.colors.length);
    // Unscheduled pins only control the camera after an explicit Saved click, never during a background refresh.
    const points = savedOverview ? plan.points.filter(p => p.kind === "place" && !p.colors.length)
      : overview ? plan.points : active.length ? active : scheduled;
    if (points.length) target = { kind: "bounds", coordinates: points.map(p => [p.lon, p.lat]), maxZoom: 14, padding: 70 };
    else if (destination?.bounds) {
      const [south, north, west, east] = destination.bounds;
      target = { kind: "bounds", coordinates: [[west, south], [east, north]], maxZoom: 12, padding: 40 };
    } else if (destination) target = { kind: "point", lat: destination.lat, lon: destination.lon, zoom: 11 };
    else target = { kind: "pending" };
  }
  return { key, target };
}
export class CameraController {
  private key: string | null = null;
  private settled = false;
  // A manual gesture also cancels a late destination response for the current intent.
  interact() { this.settled = true; }
  next(request: ReturnType<typeof cameraRequest>): CameraTarget | null {
    if (request.key !== this.key) { this.key = request.key; this.settled = false; }
    if (this.settled || request.target.kind === "pending") return null;
    this.settled = true;
    return request.target;
  }
}
