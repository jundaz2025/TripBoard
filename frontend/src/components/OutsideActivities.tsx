// Preserve access to older itinerary entries after a trip is shortened or moved.
import { useState } from "react";
import { api, message, clockLabel } from "../api";
import { tr, translateMessage } from "../i18n";
import { dayDifference, outsideTrip } from "../tripDates";
import type { Activity, Trip } from "../types";
import Modal from "./Modal";
import DatePreview from "./DatePreview";
export default function OutsideActivities({ trip, editable, onEdit, onSaved }: {
  trip: Trip; editable: boolean; onEdit: (activity: Activity) => void; onSaved: (trip: Trip) => void;
}) {
  const rows = trip.activities.filter(a => outsideTrip(a.day, trip.start_date, trip.end_date))
    .sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  // Freeze the reviewed version and records. Collaborator edits must cause a conflict, not a different move.
  const [review, setReview] = useState<Trip | null>(null);
  const [firstDay, setFirstDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flexible = (review?.activities ?? []).filter(a => !a.locked && outsideTrip(a.day, review!.start_date, review!.end_date));
  const earliest = flexible.map(a => a.day).sort()[0];
  async function save() {
    if (!review || busy) return;
    setBusy(true); setError("");
    try {
      onSaved(await api<Trip>(`/trips/${review.id}/reschedule-activities`, "POST", {
        activity_ids: flexible.map(a => a.id), first_day: firstDay,
      }, review.version));
      setReview(null);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  if (!rows.length && !review) return null;
  return <>
    {!!rows.length && <section className="alert warning outside-activities">
      <strong>{tr("{count} activities are outside the trip dates", { count: rows.length })}</strong>
      <p>{tr("Nothing was deleted. Move these activities or edit their dates individually.")}</p>
      <ul>{rows.map(a => <li key={a.id}><span><strong>{a.title}</strong><small>{a.day} · {clockLabel(a.start)}{a.locked && ` · ${tr("Fixed reservation")}`}</small></span>
        {editable && <button className="secondary compact" onClick={() => onEdit(a)}>{tr("Edit")}</button>}
      </li>)}</ul>
      {editable && rows.some(a => !a.locked) && <button className="secondary" onClick={() => {
        setReview(trip); setFirstDay(trip.start_date); setError("");
      }}>{tr("Review moving activities")}</button>}
    </section>}
    {review && <Modal title={tr("Move activities to new dates?")} onClose={() => { if (!busy) setReview(null); }}>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>{tr("Move the earliest activity to")}<input type="date" required min={review.start_date} max={review.end_date} value={firstDay} onChange={e => setFirstDay(e.target.value)} /></label>
        <p>{tr("Only the activities listed below will move. Their spacing is preserved.")}</p>
        {firstDay && earliest && <DatePreview activities={flexible} delta={dayDifference(earliest, firstDay)} start={review.start_date} end={review.end_date} />}
        {error && <p role="alert" className="alert error">{translateMessage(error)}</p>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setReview(null)}>{tr("Cancel")}</button>
          <button disabled={busy || !firstDay}>{busy ? tr("Saving…") : tr("Confirm date changes")}</button></div>
      </form>
    </Modal>}
  </>;
}
