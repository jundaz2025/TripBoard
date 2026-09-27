// Debounces city lookup and requires explicit selection to disambiguate identical city names.
import { tr, translateMessage } from "../i18n";
import { useEffect, useState, useId } from "react";
import { MapPin, Check, LoaderCircle } from "lucide-react";
import { api, ApiError, message } from "../api";
import { timeZoneLabel } from "../timeZones";
import type { City } from "../types";

type Results = { query: string; cities: City[]; error: string };
export default function CitySearch({ value, selectedId, onChange, onSelect, label = "Destination" }: {
  label?: string;
  value: string;
  selectedId: number | null;
  onChange: (value: string) => void;
  onSelect: (city: City) => void;
}) {
  const helpId = useId();
  const [results, setResults] = useState<Results | null>(null);
  const [attempt, setAttempt] = useState(0);
  const query = value.trim();
  const current = results?.query === query ? results : null;
  const searching = !selectedId && query.length >= 2 && !current;
  useEffect(() => {
    if (selectedId || query.length < 2) return;
    // Ignore responses from superseded queries; changing the language does not restart this request.
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        let cities: City[];
        for (let retry = 0; ; retry++) {
          try {
            cities = await api<City[]>("/cities/search?q=" + encodeURIComponent(query));
            break;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 429 || retry >= 2) throw error;
            await new Promise(resolve => window.setTimeout(resolve, 1100));
            if (!active) return;
          }
        }
        if (active) setResults({ query, cities, error: "" });
      } catch (error) {
        if (active) setResults({ query, cities: [], error: message(error) });
      }
    }, 700);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, selectedId, attempt]);
  return (
    <div className="city-search full">
      <label>
        {tr(label)}
        <input value={value} maxLength={200} required autoComplete="off"
          placeholder={tr("Search for a city, e.g. Chicago")}
          onChange={event => { setResults(null); onChange(event.target.value); }}
          aria-describedby={helpId} />
      </label>
      <small id={helpId}>
        {selectedId ? tr("City selected. The time zone is set automatically.") : tr("Type a city name, then choose the correct state and country below.")}
      </small>
      {Boolean(selectedId) && <p className="city-selected"><Check size={15} /> {value}</p>}
      {searching && <p className="city-status" role="status"><LoaderCircle className="spin" size={16} />{tr(" Finding cities…")}</p>}
      {!selectedId && current && (
        current.error ? <p className="alert warning" role="alert">{translateMessage(current.error)} <button type="button" className="text-button" onClick={() => { setResults(null); setAttempt(n => n + 1); }}>{tr("Try again")}</button></p>
          : current.cities.length ? <ul className="city-results" aria-label={tr("Matching cities")}>
            {current.cities.map(city => <li key={city.id}><button type="button" className="search-result" onClick={() => onSelect(city)}>
              <MapPin size={18} /><span><strong>{city.name}</strong><small>{city.address}</small><small>{timeZoneLabel(city.timezone)}</small></span>
            </button></li>)}
          </ul> : <p className="city-status" role="status">{tr("No cities found. Try a city name followed by its country.")}</p>
      )}
      <small className="city-attribution">{tr("City data: ")}<a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noreferrer">{tr("Open-Meteo")}</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">{tr("GeoNames")}</a></small>
    </div>
  );
}
