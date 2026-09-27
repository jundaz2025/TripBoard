// Displays structured overlap intervals in the trip time zone; user-entered activity titles remain unchanged.
import { tr, translateMessage } from "../i18n";
import { humanizeTimeZones, timeZoneLabel } from "../timeZones";
import type { Conflict } from "../types";
import { dateTimeLabel } from "../travel";
export default function ConflictNotice({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length) return null;
  return <div className="alert warning conflict-notice" role="status">
    <strong>{tr("A few things to check")}</strong>
    {conflicts.map((conflict, index) => <div className="conflict-entry" key={index}>
      {conflict.kind === "overlap" && conflict.items && conflict.timezone && conflict.overlap_start && conflict.overlap_end ? <>
        <strong>{conflict.items.map(item => item.title).join(tr(" overlaps "))}</strong>
        {conflict.items.map(item => <p key={item.id}>{item.title}: {dateTimeLabel(item.start, conflict.timezone!)} – {dateTimeLabel(item.end, conflict.timezone!)}</p>)}
        <p><b>{tr("Overlap:")}</b> {dateTimeLabel(conflict.overlap_start, conflict.timezone)} – {dateTimeLabel(conflict.overlap_end, conflict.timezone)}</p>
        <small>{tr("All times shown in ")}{timeZoneLabel(conflict.timezone)}.</small>
      </> : <p>{humanizeTimeZones(translateMessage(conflict.message))}</p>}
    </div>)}
  </div>;
}
