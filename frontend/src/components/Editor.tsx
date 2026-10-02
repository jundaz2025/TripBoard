// Edits a detached form draft and retains the opening version to detect concurrent collaborator changes.
import { tr, translateMessage } from "../i18n";
import { timeZoneLabel } from "../timeZones";
import CitySearch from "./CitySearch";
import DatePreview from "./DatePreview";
import SavePlaceConfirm from "./SavePlaceConfirm";
import { dayDifference } from "../tripDates";
import { useState, useRef, useEffect } from "react";
import type { FormEvent } from "react";
import { MapPin, LoaderCircle } from "lucide-react";
import { api, ApiError, message, clockLabel } from "../api";
import HotelPolicyLookup from "./HotelPolicyLookup";
import type { HotelPolicy } from "./HotelPolicyLookup";
import type { Trip, Activity, Place, Hotel } from "../types";
import Modal from "./Modal";
import LocationSearch from "./LocationSearch";
import { placeFromResult, searchTripPlaces } from "../locations";
import type { LocationResult } from "../locations";
type Kind = "trip" | "activities" | "places" | "hotels";
type Item = Activity | Place | Hotel;
export default function Editor({
  kind,
  trip,
  item,
  day,
  onSave,
  onClose,
}: {
  kind: Kind;
  trip: Trip | null;
  item?: Item;
  day?: string;
  onSave: (data: Record<string, unknown>, version?: number) => Promise<void>;
  onClose: () => void;
}) {
  // Seed the draft once. Later shared snapshots must not overwrite fields the user is currently editing.
  const initial =
    kind === "trip"
      ? {
          title: trip?.title ?? "",
          destination: trip?.destination ?? "",
          destination_id: trip?.destination_id ?? null,
          start_date: trip?.start_date ?? new Date().toISOString().slice(0, 10),
          end_date: trip?.end_date ?? new Date().toISOString().slice(0, 10),
          timezone: trip?.timezone ?? "",
        }
      : item
        ? { ...item }
        : kind === "activities"
          ? {
              title: "",
              location: "",
              notes: "",
              day: day ?? trip?.start_date,
              start: "09:00",
              duration: 60,
              locked: false,
              place_id: "",
              reminder_minutes: 30,
            }
          : kind === "places"
            ? {
                title: "",
                location: "",
                lat: "",
                lon: "",
                category: "sight",
                hours_confirmed: false,
                duration: 60,
                opens: "09:00",
                closes: "20:00",
                notes: "",
              }
            : {
                name: "",
                address: "",
                check_in: trip?.start_date,
                check_in_time: "",
                check_out_time: "",
                hotel_website: "",
                policy_source_url: "",
                policy_checked_at: "",
                check_out: trip
                  ? new Date(
                      new Date(trip.end_date + "T12:00:00Z").getTime() +
                        86400000,
                    )
                      .toISOString()
                      .slice(0, 10)
                  : "",
                lat: "",
                lon: "",
                link: "",
                notes: "",
              };
  const [data, setData] = useState<Record<string, unknown>>(initial);
  // Do not update this version when trip props change; a stale draft must surface a conflict on save.
  const [version] = useState(trip?.version);
  const [originalTrip] = useState(trip);
  const [dateMode, setDateMode] = useState<"" | "keep" | "shift">("");
  const [pendingPlace, setPendingPlace] = useState<Record<string, unknown> | null>(null);
  const datesChanged = kind === "trip" && originalTrip &&
    (data.start_date !== originalTrip.start_date || data.end_date !== originalTrip.end_date);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPlace, setNewPlace] = useState<LocationResult | null>(null);
  const [unmapped, setUnmapped] = useState(false);
  const [matches, setMatches] = useState<LocationResult[]>([]);
  const hotelRequest = useRef(0);
  const [hotelBusy, setHotelBusy] = useState(false);
  const [hotelError, setHotelError] = useState("");
  useEffect(
    () => () => {
      hotelRequest.current += 1;
    },
    [],
  );
  function cancelHotelLookup() {
    hotelRequest.current += 1;
    setHotelBusy(false);
    setHotelError("");
  }
  async function findHotelTimes(hotel: {
    name: string;
    lat: number;
    lon: number;
    website?: string;
  }) {
    if (!trip) return;
    // A request sequence prevents an old hotel lookup from overwriting a newer selection or manual edit.
    const request = ++hotelRequest.current;
    setHotelBusy(true);
    setHotelError("");
    try {
      let result: HotelPolicy;
      for (let attempt = 0; ; attempt += 1) {
        try {
          result = await api<HotelPolicy>(
            `/trips/${trip.id}/hotel-policy`,
            "POST",
            hotel,
          );
          break;
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.status !== 429 ||
            attempt >= 2
          )
            throw error;
          // Only rate-limit responses are retried, with a bounded delay; other errors remain visible.
          await new Promise((resolve) => window.setTimeout(resolve, 3100));
          if (request !== hotelRequest.current) return;
        }
      }
      if (request !== hotelRequest.current) return;
      setData((d) => ({
        ...d,
        ...(result.check_in_time
          ? { check_in_time: result.check_in_time }
          : {}),
        ...(result.check_out_time
          ? { check_out_time: result.check_out_time }
          : {}),
        hotel_website: result.hotel_website || hotel.website || "",
        policy_source_url: result.source_url,
        policy_checked_at: result.checked_at,
      }));
    } catch (error) {
      if (request === hotelRequest.current) setHotelError(message(error));
    } finally {
      if (request === hotelRequest.current) setHotelBusy(false);
    }
  }
  function pickLocation(r: LocationResult) {
    setError("");
    setMatches([]);
    if (kind === "activities") {
      setNewPlace(r);
      setUnmapped(false);
      setData((d) => ({
        ...d,
        place_id: "",
        map_location: { lat: r.lat, lon: r.lon },
        location: r.address.slice(0, 300),
        title: d.title || r.name.slice(0, 160),
      }));
    } else
      setData((d) => ({
        ...d,
        lat: r.lat,
        lon: r.lon,
        ...(kind === "hotels"
          ? {
              hotel_website: /^https?:\/\//i.test(r.website || "")
                ? r.website
                : "",
              policy_source_url: "",
              policy_checked_at: "",
              check_in_time: "",
              check_out_time: "",
            }
          : {}),
        [kind === "places" ? "title" : "name"]:
          kind === "hotels"
            ? r.name.slice(0, 160)
            : d.title || r.name.slice(0, 160),
        [kind === "places" ? "location" : "address"]: r.address.slice(0, 300),
      }));
    if (kind === "hotels") {
      void findHotelTimes({
        name: r.name.slice(0, 160),
        lat: r.lat,
        lon: r.lon,
        website: /^https?:\/\//i.test(r.website || "") ? r.website : "",
      });
    }
  }
  // Manual hotel edits invalidate pending lookups and clear provenance that no longer describes the draft.
  const set = (key: string, value: unknown) => {
    if (
      kind === "hotels" &&
      ["name", "address", "check_in_time", "check_out_time"].includes(key)
    ) {
      cancelHotelLookup();
    }
    if (key === "location" && kind === "activities") {
      setNewPlace(null);
      setUnmapped(false);
      setMatches([]);
      setData((d) => ({ ...d, location: value, place_id: "", map_location: null }));
    } else if (kind === "hotels" && key === "address") {
      setData((d) => ({
        ...d,
        address: value,
        lat: "",
        lon: "",
        hotel_website: "",
        policy_source_url: "",
        policy_checked_at: "",
        check_in_time: "",
        check_out_time: "",
      }));
    } else if (
      kind === "hotels" &&
      ["name", "check_in_time", "check_out_time", "hotel_website"].includes(key)
    ) {
      setData((d) => ({
        ...d,
        [key]: value,
        policy_source_url: "",
        policy_checked_at: "",
      }));
    } else setData((d) => ({ ...d, [key]: value }));
  };
  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
    extras: Record<string, string | number> = {},
  ) => (
    <label key={key}>
      {tr(label)}
      <input
        type={type}
        required={required}
        value={String(data[key] ?? "")}
        onChange={(e) =>
          set(
            key,
            type === "number"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
        {...extras}
      />
    </label>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || hotelBusy) return;
    setBusy(true);
    setError("");
    try {
      // Work on a payload copy so stripping IDs or normalizing optional fields does not mutate the draft.
      const body = { ...data };
      delete body.id;
      if (kind === "trip" && !body.destination_id && (!trip || body.destination !== trip.destination)) {
        throw new Error("Choose a city from the destination results before saving.");
      }
      if (datesChanged && originalTrip.activities.length) {
        if (!dateMode) throw new Error("Choose whether to move activities or keep their dates.");
        body.activity_date_mode = dateMode;
      }
      if (kind === "activities") {
        body.place_id = body.place_id || null;
        // Coordinates belong to the activity; creating a reusable Saved place remains optional.
        if (newPlace) {
          body.map_location = { lat: newPlace.lat, lon: newPlace.lon };
          body.new_place = placeFromResult(newPlace);
        }
        else if (
          !body.place_id &&
          !body.map_location &&
          String(body.location ?? "").trim() &&
          !unmapped
        ) {
          if (!trip)
            throw new Error(
              "Open a trip before searching for an activity location.",
            );
          const rows = await searchTripPlaces(trip.id, String(body.location));
          // Pause saving until the user chooses a result or explicitly allows an activity without a pin.
          setMatches(rows);
          setError(
            rows.length
              ? "Choose the correct location below, then save your activity."
              : `No location found in ${trip.destination}. Try a local address, or choose Save without a map pin.`,
          );
          return;
        }
        body.reminder_minutes =
          body.reminder_minutes === "" ? null : Number(body.reminder_minutes);
      }
      if (kind === "hotels") {
        if (typeof body.lat !== "number" || typeof body.lon !== "number") {
          throw new Error(
            "Search for your hotel above and select a result to set its map location.",
          );
        }
        body.check_in_time = body.check_in_time || null;
        body.check_out_time = body.check_out_time || null;
      }
      if ((kind === "activities" && body.new_place) || (kind === "places" && !item)) {
        setPendingPlace(body);
        return;
      }
      await onSave(body, version);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmPlace(saveLocation: boolean) {
    if (!pendingPlace || busy) return;
    setBusy(true); setError("");
    try {
      const body = { ...pendingPlace };
      if (!saveLocation) delete body.new_place;
      await onSave(body, version);
      onClose();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  // Replace the editor dialog while confirming, preserving its draft and version in component state.
  if (pendingPlace) return <SavePlaceConfirm
    name={String(kind === "activities" ? (pendingPlace.new_place as Record<string, unknown>).title : pendingPlace.title)}
    address={String(pendingPlace.location || "")}
    activity={kind === "activities"} busy={busy} error={error}
    onConfirm={() => void confirmPlace(true)}
    onActivityOnly={kind === "activities" ? () => void confirmPlace(false) : undefined}
    onCancel={() => { setPendingPlace(null); setError(""); }}
  />;
  const title =
    kind === "trip"
      ? trip
        ? "Trip settings"
        : "Create a trip"
      : `${item ? "Edit" : "Add"} ${kind === "activities" ? "activity" : kind === "places" ? "saved place" : "hotel reservation"}`;
  return (
    <Modal
      title={title}
      subtitle={
        kind === "activities"
          ? tr("All times shown in {zone}", {zone: timeZoneLabel(trip?.timezone)})
          : kind === "hotels"
            ? tr("Keep an existing reservation together with your plan.")
            : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {kind !== "trip" && trip && (
          <div className="search-box">
            <LocationSearch
              trip={trip}
              initialQuery={String(data.location || data.address || "")}
              onSelect={pickLocation}
            />
            {kind === "hotels" &&
              typeof data.lat === "number" &&
              typeof data.lon === "number" && (
                <p className="location-selected">
                  <MapPin size={17} />{tr(" Map location selected")}</p>
              )}
            {newPlace && (
              <div className="location-selected">
                <MapPin size={17} />
                <span>
                  <strong>{newPlace.name}</strong>
                  <small>{newPlace.address}</small>
                </span>
                <span className="pin-ready">{tr("Pin ready")}</span>
              </div>
            )}
          </div>
        )}
        <div className="form-grid">
          {kind === "trip" && (
            <>
              {field("title", "Trip title")}
              <CitySearch
                value={String(data.destination ?? "")}
                selectedId={typeof data.destination_id === "number" ? data.destination_id : null}
                onChange={(value) => setData(d => ({ ...d, destination: value, destination_id: null, timezone: "" }))}
                onSelect={(city) => {
                  setError("");
                  setData(d => ({ ...d, destination: city.address, destination_id: city.id, timezone: city.timezone }));
                }}
              />
              {field("start_date", "First day", "date")}
              {field("end_date", "Last day", "date")}
              {datesChanged && originalTrip.activities.length > 0 && <div className="full date-policy">
                <label>{tr("How should existing activities change?")}<select required value={dateMode} onChange={e => setDateMode(e.target.value as "keep" | "shift")}>
                  <option value="">{tr("Choose a date option")}</option>
                  <option value="shift">{tr("Move flexible activities with the trip")}</option>
                  <option value="keep">{tr("Keep all activity dates")}</option>
                </select></label>
                {dateMode && data.start_date && data.end_date ? <DatePreview activities={originalTrip.activities} delta={dateMode === "shift" ? dayDifference(originalTrip.start_date, String(data.start_date)) : 0} start={String(data.start_date)} end={String(data.end_date)} /> : null}
              </div>}
              <label>{tr("Time zone")}<input value={timeZoneLabel(String(data.timezone ?? ""))} readOnly placeholder={tr("Choose a destination first")} />
              </label>
              <p className="field-help">{tr("Set from your selected city, including daylight saving time.")}{trip && tr(" Reselect your city to update its time zone. Existing activities keep their local clock times.")}
              </p>
            </>
          )}
          {kind === "activities" && (
            <>
              <label className="full">{tr("Saved place")}<select
                  value={String(data.place_id ?? "")}
                  onChange={(e) => {
                    const p = trip?.places.find((p) => p.id === e.target.value);
                    setNewPlace(null);
                    setMatches([]);
                    setUnmapped(false);
                    setData((d) => ({
                      ...d,
                      place_id: e.target.value,
                      map_location: p ? { lat: p.lat, lon: p.lon } : null,
                      ...(p
                        ? {
                            title: p.title,
                            location: p.location,
                            duration: p.duration,
                          }
                        : {}),
                    }));
                  }}
                >
                  <option value="">{tr("Choose a saved place or find a new address above")}</option>
                  {trip?.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              {field("title", "Activity title")}
              {field("location", "Address or place name", "text", false)}
              {!data.place_id && !newPlace && !data.map_location && (
                <div className="full">
                  {matches.map((r, i) => (
                    <button
                      type="button"
                      key={i}
                      className="search-result"
                      onClick={() => pickLocation(r)}
                    >
                      <MapPin size={16} />
                      <span>
                        {r.name}
                        <small>{r.address}</small>
                      </span>
                    </button>
                  ))}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={unmapped}
                      onChange={(e) => setUnmapped(e.target.checked)}
                    />{tr("Save without a map pin")}</label>
                  <small>{tr("Otherwise, saving looks up your address and asks you to confirm its location.")}</small>
                </div>
              )}
              {field("day", "Day", "date", true, {
                min: trip?.start_date ?? "",
                max: trip?.end_date ?? "",
              })}
              {field("start", "Start time", "time")}
              {field("duration", "Duration (minutes)", "number", true, {
                min: 5,
                max: 1440,
              })}
              <label>{tr("Reminder")}<select
                  value={
                    data.reminder_minutes == null
                      ? ""
                      : String(data.reminder_minutes)
                  }
                  onChange={(e) => set("reminder_minutes", e.target.value)}
                >
                  <option value="">{tr("No reminder")}</option>
                  {[0, 5, 15, 30, 60, 120, 1440].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? tr("At start") : tr("{p0} minutes before", { p0: m })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check full">
                <input
                  type="checkbox"
                  checked={Boolean(data.locked)}
                  onChange={(e) => set("locked", e.target.checked)}
                />{tr("Fixed reservation — AI and route optimization cannot move it.")}</label>
            </>
          )}
          {kind === "places" && (
            <>
              {field("title", "Place name")}
              {field("location", "Address", "text", false)}
              <label>{tr("Category")}<select
                  value={String(data.category)}
                  onChange={(e) => set("category", e.target.value)}
                >
                  <option value="sight">{tr("Sight")}</option>
                  <option value="food">{tr("Food & coffee")}</option>
                  <option value="hotel">{tr("Hotel")}</option>
                  <option value="other">{tr("Other")}</option>
                </select>
              </label>
              {field("duration", "Suggested stay (minutes)", "number", true, {
                min: 5,
                max: 600,
              })}
              <label className="check full">
                <input
                  type="checkbox"
                  checked={data.hours_confirmed !== false}
                  onChange={(e) => set("hours_confirmed", e.target.checked)}
                />{tr("Use these opening hours as planning constraints")}</label>
              {field("opens", "Opens (your saved hours)", "time")}
              {field("closes", "Closes (your saved hours)", "time")}
            </>
          )}
          {kind === "hotels" && (
            <>
              {field("name", "Hotel name")}
              {field("address", "Address", "text", false)}
              {field("check_in", "Check-in date", "date")}
              {field("check_out", "Check-out date", "date")}
              {field("check_in_time", "Check-in time", "time", false)}
              {field("check_out_time", "Check-out time", "time", false)}
              <p className="field-help full">{tr("Published times are filled in when available. Your booking confirmation takes priority. Current trip time zone: ")}{timeZoneLabel(trip?.timezone)}.
              </p>
              {field("link", "Reservation link", "url", false)}
              <p className="hotel-reminder" role="note">
                <strong>
                  {data.check_in_time || data.check_out_time
                    ? tr("Reminders: two hours before {p0}{p1}{p2}, in {p3}. Only saved times receive reminders.", { p0: data.check_in_time ? tr("check-in ({time})", {time: clockLabel(String(data.check_in_time))}) : "", p1: data.check_in_time && data.check_out_time ? tr(" and ") : "", p2: data.check_out_time ? tr("check-out ({time})", {time: clockLabel(String(data.check_out_time))}) : "", p3: timeZoneLabel(trip?.timezone) })
                    : tr("Reminders: add check-in and check-out times to receive a reminder two hours before each, in the trip time zone.")}
                </strong>
              </p>
              {trip && (
                <HotelPolicyLookup
                  canSearch={
                    Boolean(data.name) &&
                    typeof data.lat === "number" &&
                    typeof data.lon === "number"
                  }
                  busy={hotelBusy}
                  error={translateMessage(hotelError)}
                  source={String(data.policy_source_url || "")}
                  checkedAt={String(data.policy_checked_at || "")}
                  onRetry={() =>
                    void findHotelTimes({
                      name: String(data.name),
                      lat: Number(data.lat),
                      lon: Number(data.lon),
                      website: String(data.hotel_website || ""),
                    })
                  }
                />
              )}
            </>
          )}
          {kind === "places" && (
            <>
              {field("lat", "Latitude", "number", true, {
                min: -90,
                max: 90,
                step: "any",
              })}
              {field("lon", "Longitude", "number", true, {
                min: -180,
                max: 180,
                step: "any",
              })}
            </>
          )}
          {kind !== "trip" && (
            <label className="full">{tr("Notes")}<textarea
                value={String(data.notes ?? "")}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                maxLength={3000}
              />
            </label>
          )}
        </div>
        {error && (
          <div className="alert error" role="alert">
            {translateMessage(error)}
            {error.includes("changed this trip") && (
              <p>{tr("Your edits are kept here. Copy any text you need, then close this dialog and reopen the latest item to reconcile the changes.")}</p>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>{tr("Cancel")}</button>
          <button disabled={busy || hotelBusy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : null}
            {busy
              ? tr("Saving…")
              : tr("Save " +
                (kind === "trip"
                  ? "trip"
                  : kind === "activities"
                    ? "activity"
                    : kind === "places"
                      ? "place"
                      : "reservation"))}
          </button>
        </div>
      </form>
    </Modal>
  );
}
