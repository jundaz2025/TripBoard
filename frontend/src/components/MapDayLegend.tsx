// Day buttons switch the itinerary; Saved provides an explicit camera focus without changing the schedule.
import { tr } from "../i18n";
import type { MapPlan } from "../mapPlan";
import { SAVED_COLOR, HOTEL_COLOR, SEARCH_COLOR } from "../mapPlan";

export default function MapDayLegend({ plan, onSelectDay, onSelectSaved, focus }: {
  plan: MapPlan;
  onSelectDay: (day: string) => void;
  onSelectSaved: () => void;
  focus: "day" | "saved" | "all";
}) {
  const selected = plan.days.find(day => day.day === plan.selectedDay)!;
  return <div className="map-day-key">
    <ul aria-label={tr("Map colors by day")}>
      {plan.days.map(day => <li key={day.day} className="day-choice">
        <button type="button" className="map-day-button" aria-pressed={focus === "day" && day.day === plan.selectedDay} onClick={() => onSelectDay(day.day)}>
          <i style={{ backgroundColor: day.color }} aria-hidden="true" />
          {day.label}{focus === "day" && day.day === plan.selectedDay && <strong>{tr("Selected")}</strong>}
        </button>
      </li>)}
      {plan.hasUnscheduled && <li className="day-choice">
        <button type="button" className="map-day-button" aria-pressed={focus === "saved"} onClick={onSelectSaved}>
          <i style={{ backgroundColor: SAVED_COLOR }} aria-hidden="true" />{tr("Saved · not scheduled")}
          {focus === "saved" && <strong>{tr("Selected")}</strong>}
        </button>
      </li>}
      {plan.hasHotels && <li><i style={{ backgroundColor: HOTEL_COLOR }} aria-hidden="true" />{tr("Hotel")}</li>}
      {plan.points.some(point => point.kind === "search") && <li><i style={{ backgroundColor: SEARCH_COLOR }} aria-hidden="true" />{tr("Search result")}</li>}
    </ul>
    {focus === "saved" && <p role="status">{tr("Showing saved places that are not scheduled. Select a day to return to its itinerary.")}</p>}
    {focus === "day" && !plan.hasSelectedActivities && <p role="status">{tr("No mapped activities for Day {number}.", {number: selected.number})} {plan.hasScheduled ? tr("Other days are shown for reference.") : tr("Locate an activity to show it in this day's color.")}</p>}
    {plan.hasShared && <p>{tr("A multicolor ring marks a place visited on more than one day.")}</p>}
  </div>;
}
