// Groups the shared travel records by outbound or return direction without changing their stored ordering.
import { tr } from "../i18n";
import { Plus, Plane } from "lucide-react";
import type { Trip, Transport } from "../types";
import TransportCard from "./TransportCard";
export default function TransportPanel({ trip, direction, editable, onAdd, onEdit, onDelete }: {
  trip: Trip; direction: Transport["direction"]; editable: boolean; onAdd: (direction: Transport["direction"]) => void;
  onEdit: (leg: Transport) => void; onDelete: (leg: Transport) => void;
}) {
  const legs = (trip.transports ?? []).filter(leg => leg.direction === direction).sort((a,b) => a.departure_at.localeCompare(b.departure_at));
  return <section className="transport-group" aria-label={direction === "outbound" ? tr("Getting there") : tr("Heading home")}>
    <div className="section-heading"><h3>{direction === "outbound" ? tr("Getting there") : tr("Heading home")}</h3>{editable && <button className="secondary" onClick={() => onAdd(direction)}><Plus size={16} />{direction === "outbound" ? tr("Add outbound travel") : tr("Add return travel")}</button>}</div>
    {legs.map(leg => <TransportCard key={leg.id} leg={leg} editable={editable} onEdit={() => onEdit(leg)} onDelete={() => onDelete(leg)} />)}
    {!legs.length && <div className="empty-card transport-empty"><Plane size={24} /><p>{direction === "outbound" ? tr("Add how you will get to your destination.") : tr("Keep your return journey here.")}</p></div>}
  </section>;
}
