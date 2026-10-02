// Show every reviewed move, including fixed reservations and overflow that will remain available.
import { tr } from "../i18n";
import { clockLabel } from "../api";
import { datePreview } from "../tripDates";
import type { Activity } from "../types";
export default function DatePreview({ activities, delta, start, end }: {
  activities: Activity[]; delta: number; start: string; end: string;
}) {
  const rows = datePreview(activities, delta, start, end);
  return <div className="date-preview">
    <p>{tr("Local times stay the same. Hotels, travel and fixed reservations keep their dates.")}</p>
    <ul>{rows.map(({ activity, nextDay, outside }) => <li key={activity.id}>
      <strong>{activity.title}</strong>
      <span>{activity.day}{nextDay !== activity.day && <> → {nextDay}</>} · {clockLabel(activity.start)}</span>
      {activity.locked && <small>{tr("Fixed reservation · unchanged")}</small>}
      {outside && <small className="date-warning">{tr("Outside trip dates · kept for review")}</small>}
    </li>)}</ul>
  </div>;
}
