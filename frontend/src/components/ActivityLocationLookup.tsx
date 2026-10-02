// Resolve legacy text-only activities for viewing without editing the trip or creating a Saved place.
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { tr, translateMessage } from "../i18n";
import { message } from "../api";
import { searchTripPlaces } from "../locations";
import type { LocationResult } from "../locations";
import type { Activity, Trip } from "../types";
import Modal from "./Modal";
import LocationSearch from "./LocationSearch";

export default function ActivityLocationLookup({ trip, activity, onLocate, onClose }: {
  trip: Trip; activity: Activity;
  onLocate: (id: string, address: string, result: LocationResult) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<LocationResult[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const { id, location, title } = activity;
  const query = location || title;
  useEffect(() => {
    let active = true;
    searchTripPlaces(trip.id, query).then(rows => {
      if (!active) return;
      // One unambiguous match needs no extra click; several matches require an explicit selection.
      if (rows.length === 1) onLocate(id, location, rows[0]);
      else setResults(rows);
    }).catch(error => { if (active) setError(message(error)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [trip.id, query, id, location, onLocate]);

  return <Modal title={tr("Locate on map")} subtitle={title} onClose={onClose}>
    <p>{tr("Viewing a location does not add it to Saved places.")}</p>
    {busy ? <p role="status">{tr("Finding places…")}</p> : <>
      {error && <p className="alert error" role="alert">{translateMessage(error)}</p>}
      {results.length > 0 ? <>
        <p>{tr("Choose the matching location.")}</p>
        <div className="location-results">
          {results.map((result, index) => <button key={index} type="button" className="search-result"
            onClick={() => onLocate(id, location, result)}>
            <MapPin size={17} /><span><strong>{result.name}</strong><small>{result.address}</small></span>
          </button>)}
        </div>
      </> : !error && <p role="status">{tr("No matching places in ")}{trip.destination}{tr(". Try another name or address in this area.")}</p>}
      <LocationSearch trip={trip} initialQuery={query} onSelect={result => onLocate(id, location, result)} />
    </>}
  </Modal>;
}
