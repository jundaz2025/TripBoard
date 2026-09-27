// Explains day colors and shared-place rings without treating unscheduled places as daily activities.
import { tr } from "../i18n";
import type { MapPlan } from "../mapPlan";
import { SAVED_COLOR, HOTEL_COLOR, SEARCH_COLOR } from "../mapPlan";

export default function MapDayLegend({ plan }: { plan: MapPlan }) {
  const selected = plan.days.find(day => day.day === plan.selectedDay)!;
  return <div className="map-day-key">
    <ul aria-label={tr("Map colors by day")}>
      {plan.days.map(day => <li key={day.day} className={day.day === plan.selectedDay ? "active" : ""}>
        <i style={{ backgroundColor: day.color }} aria-hidden="true" />
        {day.label}{day.day === plan.selectedDay && <strong>{tr("Selected")}</strong>}
      </li>)}
      {plan.hasUnscheduled && <li><i style={{ backgroundColor: SAVED_COLOR }} aria-hidden="true" />{tr("Saved · not scheduled")}</li>}
      {plan.hasHotels && <li><i style={{ backgroundColor: HOTEL_COLOR }} aria-hidden="true" />{tr("Hotel")}</li>}
      {plan.points.some(point => point.kind === "search") && <li><i style={{ backgroundColor: SEARCH_COLOR }} aria-hidden="true" />{tr("Search result")}</li>}
    </ul>
    {!plan.hasSelectedActivities && <p role="status">{tr("No mapped activities for Day {number}.", {number: selected.number})} {plan.hasScheduled ? tr("Other days are shown for reference.") : tr("Add a saved place to this day to give it a day color.")}</p>}
    {plan.hasShared && <p>{tr("A multicolor ring marks a place visited on more than one day.")}</p>}
  </div>;
}
