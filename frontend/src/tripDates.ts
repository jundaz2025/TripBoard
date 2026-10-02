// Use UTC calendar arithmetic so date previews do not gain or lose a day across DST.
import type { Activity } from "./types";
export function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000);
}
export function shiftDay(day: string, delta: number) {
  return new Date(Date.parse(day + "T12:00:00Z") + delta * 86_400_000).toISOString().slice(0, 10);
}
export function outsideTrip(day: string, start: string, end: string) {
  return day < start || day > end;
}
export function datePreview(activities: Activity[], delta: number, start: string, end: string) {
  return activities.map(activity => {
    const nextDay = activity.locked ? activity.day : shiftDay(activity.day, delta);
    return { activity, nextDay, outside: outsideTrip(nextDay, start, end) };
  });
}
