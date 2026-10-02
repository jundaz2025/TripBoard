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
import type { LocatedActivities } from "../activityLocation";
import MapDayLegend from "./MapDayLegend";
import SavePlaceConfirm from "./SavePlaceConfirm";
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
  overview?: number;
  savedOverview?: number;
  focusRevision?: number;
};
export default function MapView(
  props: Omit<MapProps, "plan"> & { editable: boolean; onSaved: (trip: Trip) => void; onSelectDay: (day: string) => void; locatedActivities?: LocatedActivities },
) {
  useLanguage();
  const [previewResult, setPreviewResult] = useState<{
    destination: string;
    day: string;
    focusRevision?: number;
    location: LocationResult;
  } | null>(null);
  // A date selection clears search focus, even when the user clicks the already selected day.
  const preview =
    previewResult?.destination === props.trip.destination && previewResult.day === props.day && previewResult.focusRevision === props.focusRevision
      ? previewResult.location
      : null;
  // Rebuild localized marker descriptions without remounting the map or changing the saved trip.
  const plan = buildMapPlan(props.trip, props.day, preview, props.locatedActivities);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPlace, setPendingPlace] = useState<{ location: LocationResult; version: number } | null>(null);
  const [overview, setOverview] = useState<{ context: string; count: number; scope: "all" | "saved" }>({ context: "", count: 0, scope: "all" });
  const context = JSON.stringify([props.trip.id, props.day, props.selected, preview?.lat, preview?.lon, props.focusRevision]);
  const showAll = overview.context === context && overview.scope === "all" ? overview.count : 0;
  const showSaved = overview.context === context && overview.scope === "saved" && plan.hasUnscheduled ? overview.count : 0;
  function showPlaces(scope: "all" | "saved") {
    setPreviewResult(null);
    props.onSelect("");
    // Clear any previous pin/search focus, and make repeat clicks recenter after a manual pan.
    setOverview(previous => ({
      context: JSON.stringify([props.trip.id, props.day, "", undefined, undefined, props.focusRevision]),
      count: previous.count + 1, scope,
    }));
  }
  const destination = useDestination(
    props.trip.destination,
    true,
    props.trip.destination_location,
  );
  const onError = useCallback(() => setFailed(true), []);
  // MapLibre is used without a key or after Google fails; place search remains a separate service.
  const google = Boolean(googleMapsKey) && !failed;
  async function save() {
    if (!pendingPlace || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Trip>(
        `/trips/${props.trip.id}/items/places`,
        "POST",
        placeFromResult(pendingPlace.location),
        pendingPlace.version,
      );
      props.onSaved(next);
      props.onSelect(next.places[next.places.length - 1].id);
      setPreviewResult(null);
      setPendingPlace(null);
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
            day: props.day,
            focusRevision: props.focusRevision,
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
            <button disabled={busy} onClick={() => { setError(""); setPendingPlace({ location: preview, version: props.trip.version }); }}>
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
      <div className="map-view-actions">
        <button type="button" className="secondary compact" aria-pressed={Boolean(showAll)}
          onClick={() => showPlaces("all")}>{tr("Show all places")}</button>
      </div>
      <MapDayLegend plan={plan} onSelectDay={props.onSelectDay} onSelectSaved={() => showPlaces("saved")}
        focus={showSaved ? "saved" : showAll ? "all" : "day"} />
      <Suspense
        fallback={<div className="map-panel loading-page">{tr("Loading map…")}</div>}
      >
        {google ? (
          <GoogleMap
            {...props}
            plan={plan}
            overview={showAll}
            savedOverview={showSaved}
            preview={preview}
            destination={destination.location}
            onError={onError}
          />
        ) : (
          <OpenMap
            {...props}
            plan={plan}
            overview={showAll}
            savedOverview={showSaved}
            preview={preview}
            destination={destination.location}
          />
        )}
      </Suspense>
      {!googleMapsKey && (
        <p className="map-provider-note">{tr("Google Maps is available after a Maps API key is configured.")}</p>
      )}
      {pendingPlace && <SavePlaceConfirm name={pendingPlace.location.name} address={pendingPlace.location.address}
        busy={busy} error={error} onConfirm={() => void save()} onCancel={() => { setPendingPlace(null); setError(""); }} />}
    </section>
  );
}
