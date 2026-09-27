// Presents endpoint-local journey times alongside the absolute elapsed duration supplied by the server.
import { tr } from "../i18n";
import { Plane, Car, TrainFront, Bus, Ship, Route, Pencil, Trash2, ArrowRight, Clock, Link } from "lucide-react";
import { timeZoneLabel } from "../timeZones";
import type { Transport } from "../types";
import { dateTimeLabel, transportModes } from "../travel";
const icons = { flight: Plane, driving: Car, train: TrainFront, bus: Bus, ferry: Ship, other: Route };
export default function TransportCard({ leg, editable, onEdit, onDelete }: {
  leg: Transport; editable: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const Icon = icons[leg.mode];
  return <article className="transport-card">
    <div className="transport-card-heading">
      <span className="badge"><Icon size={14} /> {leg.direction === "outbound" ? tr("Outbound") : tr("Return")} · {tr(transportModes[leg.mode])}</span>
      {editable && <div className="button-row">
        <button className="icon-button" aria-label={tr("Edit {p0}", { p0: leg.title })} onClick={onEdit}><Pencil size={16} /></button>
        <button className="icon-button danger" aria-label={tr("Delete {p0}", { p0: leg.title })} onClick={onDelete}><Trash2 size={16} /></button>
      </div>}
    </div>
    <h3>{leg.title}</h3>
    {(leg.carrier || leg.number) && <p>{[leg.carrier, leg.number].filter(Boolean).join(" · ")}</p>}
    <div className="transport-route">
      <div><small>{tr("DEPARTURE")}</small><strong>{leg.origin}</strong>{leg.departure_point && <p>{leg.departure_point}</p>}<b>{dateTimeLabel(leg.departure_at, leg.departure_timezone)}</b><small>{timeZoneLabel(leg.departure_timezone)}</small></div>
      <ArrowRight size={20} className="transport-arrow" />
      <div><small>{tr("ARRIVAL")}</small><strong>{leg.destination}</strong>{leg.arrival_point && <p>{leg.arrival_point}</p>}<b>{dateTimeLabel(leg.arrival_at, leg.arrival_timezone)}</b><small>{timeZoneLabel(leg.arrival_timezone)}</small></div>
    </div>
    <div className="transport-details"><span><Clock size={14} /> {Math.floor(leg.duration_minutes / 60)}{tr("h ")}{leg.duration_minutes % 60}{tr("m")}</span>{leg.reference && <span>{tr("Booking reference: ")}{leg.reference}</span>}{leg.link && <a href={leg.link} target="_blank" rel="noreferrer"><Link size={14} />{tr(" Open reservation")}</a>}</div>
    {leg.notes && <p className="transport-notes">{leg.notes}</p>}
  </article>;
}
