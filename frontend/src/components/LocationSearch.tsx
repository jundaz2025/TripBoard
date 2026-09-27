// Searches inside the selected trip destination and distinguishes empty results from provider failures.
import { tr, translateMessage } from "../i18n";
import { useState } from "react";
import { Search, MapPin, LoaderCircle } from "lucide-react";
import { message } from "../api";
import { searchTripPlaces } from "../locations";
import type { Trip } from "../types";
import type { LocationResult } from "../locations";
type SearchProps = {
  trip: Pick<Trip, "id" | "destination">;
  onSelect: (r: LocationResult) => void;
  initialQuery?: string;
};

export default function LocationSearch(props: SearchProps) {
  return (
    <ScopedLocationSearch
      // Reset results when the destination changes so another city's pins cannot leak into this search.
      key={props.trip.id + ":" + props.trip.destination}
      {...props}
    />
  );
}

function ScopedLocationSearch({
  trip,
  onSelect,
  initialQuery = "",
}: SearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<LocationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  async function search() {
    if (busy || query.trim().length < 3) return;
    setBusy(true);
    setError("");
    setResults([]);
    setSearched(false);
    try {
      setResults(await searchTripPlaces(trip.id, query));
      setSearched(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="location-search">
      <label>{tr("Find an address or place")}<div className="search-row">
          <input
            disabled={busy}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearched(false);
              setResults([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            placeholder={tr("Search in {p0}", { p0: trip.destination })}
            maxLength={300}
            autoComplete="off"
          />
          <button
            type="button"
            className="secondary"
            onClick={search}
            disabled={busy || query.trim().length < 3}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Search size={16} />
            )}{tr("Search")}</button>
        </div>
      </label>
      <small>{tr("Searching within ")}{trip.destination}{tr(". Results outside this area are excluded. Search by OpenStreetMap.")}</small>
      {busy && <p role="status">{tr("Finding places…")}</p>}
      {results.length > 0 && (
        <div className="location-results" aria-label={tr("Matching places")}>
          {results.map((r, i) => (
            <button
              className="search-result"
              type="button"
              key={i}
              onClick={() => {
                onSelect(r);
                setResults([]);
                setSearched(false);
              }}
            >
              <MapPin size={17} />
              <span>
                <strong>{r.name}</strong>
                <small>{r.address}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {searched && !results.length && (
        <p role="status">{tr("No matching places in ")}{trip.destination}{tr(". Try another name or address in this area.")}</p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {translateMessage(error)}
        </p>
      )}
    </div>
  );
}
