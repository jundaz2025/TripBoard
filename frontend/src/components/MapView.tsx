// Coordinates destination focus, search previews and saving pins while selecting the available map renderer.
import { tr, translateMessage } from "../i18n";
import { lazy, Suspense, useCallback, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import type { Trip } from "../types";
import { api, message } from "../api";
import { googleMapsKey } from "../googleMaps";
import LocationSearch from "./LocationSearch";
import { placeFromResult } from "../locations";
import type { LocationResult } from "../locations";
import { useDestination } from "../useDestination";
import { useLanguage } from "../useLanguage";
import { buildMapPlan } from "../mapPlan";
import type { MapPlan } from "../mapPlan";
import MapDayLegend from "./MapDayLegend";
const OpenMap = lazy(() => import("./OpenMap"));
const GoogleMap = lazy(() => import("./GoogleMap"));
export type MapProps = {
  plan: MapPlan;
  trip: Trip;
  day: string;
  selected: string | null;
  onSelect: (id: string) => void;
  preview?: LocationResult | null;
  destination?: LocationResult | null;
};
export default function MapView(
  props: Omit<MapProps, "plan"> & { editable: boolean; onSaved: (trip: Trip) => void },
) {
  useLanguage();
  const [previewResult, setPreviewResult] = useState<{
    destination: string;
    location: LocationResult;
  } | null>(null);
  // A search preview belongs to its destination and must not follow the user into another city.
  const preview =
    previewResult?.destination === props.trip.destination
      ? previewResult.location
      : null;
  // Rebuild localized marker descriptions without remounting the map or changing the saved trip.
  const plan = buildMapPlan(props.trip, props.day, preview);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = useDestination(
    props.trip.destination,
    !preview && !props.trip.places.length && !props.trip.hotels.length,
    props.trip.destination_location,
  );
  const onError = useCallback(() => setFailed(true), []);
  // MapLibre is used without a key or after Google fails; place search remains a separate service.
  const google = Boolean(googleMapsKey) && !failed;
  async function save() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Trip>(
        `/trips/${props.trip.id}/items/places`,
        "POST",
        placeFromResult(preview),
        props.trip.version,
      );
      props.onSaved(next);
      props.onSelect(next.places[next.places.length - 1].id);
      setPreviewResult(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="map-workspace">
      <div className="map-heading">
        <span>
          <MapPin size={17} />{tr("Explore your surroundings")}</span>
        <small>{google ? tr("Google Maps") : tr("OpenStreetMap")}</small>
      </div>
      {destination.loading && (
        <p className="map-provider-note" role="status">{tr("Finding ")}{props.trip.destination}{tr(" on the map…")}</p>
      )}
      {destination.location && (
        <p className="map-provider-note" role="status">{tr("Exploring ")}{destination.location.name}
        </p>
      )}
      {destination.error && (
        <p className="map-provider-note" role="status">
          {translateMessage(destination.error)}{" "}
          <button
            type="button"
            className="text-button"
            onClick={destination.retry}
          >{tr("Try again")}</button>
        </p>
      )}
      <LocationSearch
        trip={props.trip}
        onSelect={(r) => {
          setPreviewResult({
            destination: props.trip.destination,
            location: r,
          });
          setError("");
        }}
      />
      {preview && (
        <div className="map-preview">
          <span>
            <strong>{preview.name}</strong>
            <small>{preview.address}</small>
          </span>
          {props.editable && (
            <button disabled={busy} onClick={save}>
              <Plus size={15} />
              {busy ? tr("Saving…") : tr("Save place")}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={tr("Clear search pin")}
            onClick={() => setPreviewResult(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <p className="alert error" role="alert">
          {translateMessage(error)}
        </p>
      )}
      {failed && (
        <p className="map-provider-note" role="status">{tr("Google Maps is unavailable. Showing OpenStreetMap instead.")}</p>
      )}
      <MapDayLegend plan={plan} />
      <Suspense
        fallback={<div className="map-panel loading-page">{tr("Loading map…")}</div>}
      >
        {google ? (
          <GoogleMap
            {...props}
            plan={plan}
            preview={preview}
            destination={destination.location}
            onError={onError}
          />
        ) : (
          <OpenMap
            {...props}
            plan={plan}
            preview={preview}
            destination={destination.location}
          />
        )}
      </Suspense>
      {!googleMapsKey && (
        <p className="map-provider-note">{tr("Google Maps is available after a Maps API key is configured.")}</p>
      )}
    </section>
  );
}
