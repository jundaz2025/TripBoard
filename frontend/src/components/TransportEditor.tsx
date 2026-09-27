// Edits travel endpoints separately because departure and arrival may have different dates and time zones.
import { tr, translateMessage } from "../i18n";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Trip, Transport } from "../types";
import { message } from "../api";
import Modal from "./Modal";
import CitySearch from "./CitySearch";
import TimeZoneSelect from "./TimeZoneSelect";
import { transportModes } from "../travel";

type Details = Omit<Transport, "id" | "departure_at" | "arrival_at" | "duration_minutes">;
export default function TransportEditor({ trip, item, direction = "outbound", onSave, onClose }: {
  trip: Trip; item?: Transport; direction?: Transport["direction"];
  onSave: (data: Record<string, unknown>, version: number) => Promise<void>; onClose: () => void;
}) {
  // For a return journey, suggest the origin of the earliest outbound leg as the home destination.
  const home = (trip.transports ?? []).filter(leg => leg.direction === "outbound").sort((a,b) => a.departure_at.localeCompare(b.departure_at))[0];
  const returning = direction === "return";
  const defaults: Details = {
    title: returning ? "Return flight" : "Outbound flight", direction, mode: "flight",
    origin: returning ? trip.destination : "", destination: returning ? home?.origin ?? "" : trip.destination,
    departure_city_id: returning ? trip.destination_id ?? null : null,
    arrival_city_id: returning ? home?.departure_city_id ?? null : trip.destination_id ?? null,
    departure_point: "", arrival_point: "",
    departure_date: returning ? trip.end_date : trip.start_date, departure_time: "",
    departure_timezone: returning ? trip.timezone : "",
    arrival_date: returning ? trip.end_date : trip.start_date, arrival_time: "",
    arrival_timezone: returning ? home?.departure_timezone ?? "" : trip.timezone,
    carrier: "", number: "", reference: "", link: "", notes: "",
  };
  // Copy editable fields only; the server derives UTC instants and elapsed duration from local endpoints.
  const [data, setData] = useState<Details>(() => item ? Object.fromEntries(Object.keys(defaults).map(key => [key, item[key as keyof Transport] ?? defaults[key as keyof Details]])) as Details : defaults);
  // Capture the opening version exactly as the activity editor does for concurrent-write protection.
  const [version] = useState(trip.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function field(key: keyof Details, label: string, type = "text", required = true, maxLength = 200) {
    return <label>{tr(label)}<input value={String(data[key] ?? "")} type={type} required={required} maxLength={maxLength} onChange={event => setData(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await onSave({ ...data }, version); onClose(); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <Modal title={item ? tr("Edit travel") : returning ? tr("Add return travel") : tr("Add outbound travel")} subtitle={tr("Keep your journey and booking details together. Use the local times shown on your booking.")} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>{tr("Journey")}<select value={data.direction} onChange={event => setData(previous => ({ ...previous, direction: event.target.value as Transport["direction"] }))}><option value="outbound">{tr("Outbound — getting there")}</option><option value="return">{tr("Return — heading home")}</option></select></label>
        <label>{tr("Travel mode")}<select value={data.mode} onChange={event => setData(previous => ({ ...previous, mode: event.target.value as Transport["mode"], title: /^(Outbound|Return) (flight|driving|train|bus|ferry|other)$/i.test(previous.title) ? `${previous.direction === "outbound" ? "Outbound" : "Return"} ${transportModes[event.target.value as Transport["mode"]].toLowerCase()}` : previous.title }))}>{Object.entries(transportModes).map(([key,label]) => <option key={key} value={key}>{tr(label)}</option>)}</select></label>
        {field("title", "Journey title", "text", true, 160)}
        {field("number", data.mode === "flight" ? "Flight number (optional)" : "Service / route number (optional)", "text", false, 80)}
      </div>
      <div className="transport-endpoints">
        <section className="transport-endpoint"><h3>{tr("Departure")}</h3>
          <CitySearch label={tr("Departure city")} value={data.origin} selectedId={data.departure_city_id ?? (data.origin && data.departure_timezone ? -1 : null)}
            onChange={origin => setData(previous => ({ ...previous, origin, departure_city_id: null, departure_timezone: "" }))}
            onSelect={city => setData(previous => ({ ...previous, origin: city.address, departure_city_id: city.id, departure_timezone: city.timezone }))} />
          {field("departure_point", "Airport, station or address (optional)", "text", false, 300)}
          {field("departure_date", "Departure date", "date")}
          {field("departure_time", "Departure time", "time")}
          <TimeZoneSelect label={tr("Departure time zone")} value={data.departure_timezone} onChange={departure_timezone => setData(previous => ({ ...previous, departure_timezone }))} />
        </section>
        <section className="transport-endpoint"><h3>{tr("Arrival")}</h3>
          <CitySearch label={tr("Arrival city")} value={data.destination} selectedId={data.arrival_city_id ?? (data.destination && data.arrival_timezone ? -1 : null)}
            onChange={destination => setData(previous => ({ ...previous, destination, arrival_city_id: null, arrival_timezone: "" }))}
            onSelect={city => setData(previous => ({ ...previous, destination: city.address, arrival_city_id: city.id, arrival_timezone: city.timezone }))} />
          {field("arrival_point", "Arrival airport, station or address (optional)", "text", false, 300)}
          {field("arrival_date", "Arrival date", "date")}
          {field("arrival_time", "Arrival time", "time")}
          <TimeZoneSelect label={tr("Arrival time zone")} value={data.arrival_timezone} onChange={arrival_timezone => setData(previous => ({ ...previous, arrival_timezone }))} />
        </section>
      </div>
      <p className="field-help">{tr("City selection fills each time zone automatically. Check the arrival date for overnight journeys.")}</p>
      <div className="form-grid">
        {field("carrier", "Airline / operator (optional)", "text", false, 160)}
        {field("reference", "Booking reference (optional)", "text", false, 160)}
        {field("link", "Reservation link (optional)", "url", false, 2000)}
        <label className="full">{tr("Notes")}<textarea value={data.notes} maxLength={3000} rows={3} onChange={event => setData(previous => ({ ...previous, notes: event.target.value }))} /></label>
      </div>
      {error && <p className="alert error" role="alert">{translateMessage(error)}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>{tr("Cancel")}</button><button disabled={busy}>{busy ? tr("Saving…") : tr("Save travel")}</button></div>
    </form>
  </Modal>;
}
