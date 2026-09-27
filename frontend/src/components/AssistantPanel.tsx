// Separates generating a suggestion from accepting it; a newer trip version makes an open proposal stale.
import { tr, translateMessage } from "../i18n";
import { useState } from "react";
import {
  Sparkles,
  Route,
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { api, message, days, dateLabel } from "../api";
import type { Trip, Config, Proposal } from "../types";
import Modal from "./Modal";
export default function AssistantPanel({
  trip,
  config,
  day,
  onApply,
}: {
  trip: Trip;
  config: Config | null;
  day: string;
  onApply: (t: Trip) => void;
}) {
  const [mode, setMode] = useState("edit");
  const [prompt, setPrompt] = useState("");
  const [selectedDay, setSelectedDay] = useState(day);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [hotel, setHotel] = useState("");
  const [source, setSource] = useState(
    config?.live_routes ? "live" : "estimate",
  );
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const editable = trip.role !== "viewer" && navigator.onLine;
  // Both providers produce a reviewable proposal; generating one does not save itinerary changes.
  async function generate(kind: "ai" | "optimize") {
    setBusy(kind);
    setError("");
    try {
      const data = {
        day: selectedDay,
        start,
        end,
        source,
        ...(kind === "ai" ? { mode, prompt } : { hotel_id: hotel || null }),
      };
      setProposal(
        await api(`/trips/${trip.id}/${kind}`, "POST", data, trip.version),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function apply() {
    if (!proposal) return;
    setBusy("apply");
    setError("");
    try {
      onApply(
        await api(
          `/trips/${trip.id}/proposals/${proposal.id}/apply`,
          "POST",
          {},
          // Acceptance is bound to the source version, so a suggestion cannot overwrite newer edits.
          proposal.base_version,
        ),
      );
      setProposal(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  // This disables stale proposals immediately in the UI; the server repeats the check transactionally.
  const stale = proposal && proposal.base_version !== trip.version;
  return (
    <div className="assistant-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{tr("A LITTLE HELP PLANNING")}</p>
          <h2>{tr("Make room for the good parts.")}</h2>
          <p>{tr("Preview every suggestion. You decide what becomes part of your trip.")}</p>
        </div>
        <Sparkles size={36} className="accent" />
      </div>
      <div className="card">
        <h3>{tr("Planning window")}</h3>
        <div className="form-grid">
          <label>{tr("Day")}<select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
            >
              {days(trip.start_date, trip.end_date).map((d) => (
                <option key={d} value={d}>
                  {dateLabel(d, true)}
                </option>
              ))}
            </select>
          </label>
          <label>{tr("Travel times")}<select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="estimate">{tr("Estimated walking times")}</option>
              <option value="live" disabled={!config?.live_routes}>{tr("Road network (OSRM driving)")}{!config?.live_routes ? tr(" — not configured") : ""}
              </option>
            </select>
          </label>
          <label>{tr("Start")}<input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>{tr("Finish by")}<input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <p className="field-help">{tr("Estimates use distance and walking speed. Road data requires a configured OSRM provider and does not include live traffic. Opening hours come from your saved places. Road-routing requests send stop coordinates to your configured provider.")}{" "}
          <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">{tr("OSRM")}</a>{" "}
          ·{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >{tr("© OpenStreetMap contributors")}</a>{" "}
          ·{" "}
          <a
            href="https://www.openstreetmap.org/fixthemap"
            target="_blank"
            rel="noreferrer"
          >{tr("Fix the map")}</a>
          .
        </p>
      </div>
      <div className="planning-cards">
        <section className="card">
          <span className="feature-icon">
            <Route size={24} />
          </span>
          <h3>{tr("A better way around")}</h3>
          <p>{tr("Reorder 2–10 mapped activities. Keep fixed reservations, opening hours and your available time.")}</p>
          <label>{tr("Start and finish at")}<select value={hotel} onChange={(e) => setHotel(e.target.value)}>
              <option value="">{tr("First / last activity (no hotel)")}</option>
              {trip.hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => generate("optimize")}
            disabled={!!busy || !editable}
          >
            {busy === "optimize" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Route size={16} />
            )}{tr("Optimize day")}</button>
          <small>{tr("Powered by OR-Tools. Results are feasible suggestions, not guaranteed global optima.")}</small>
        </section>
        <section className="card">
          <span className="feature-icon gold">
            <Sparkles size={24} />
          </span>
          <h3>{tr("Your AI travel assistant")}</h3>
          <p>{tr("Work with your saved places and existing plan.")}</p>
          {!config?.ai_enabled && (
            <div className="alert neutral">
              <LockKeyhole size={17} />
              <span>{tr("AI is not configured yet. Add OPENAI_API_KEY to backend/.env and restart the backend. Your key stays on the server.")}</span>
            </div>
          )}
          <label>{tr("Task")}<select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="edit">{tr("Edit part of my itinerary")}</option>
              <option value="draft">{tr("Draft an itinerary")}</option>
              <option value="next">{tr("Suggest a stop in a free time slot")}</option>
            </select>
          </label>
          <label>{tr("Your request")}<textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={3000}
              rows={4}
              placeholder={tr("Make the afternoon more relaxed. Keep my reserved museum visit.")}
            />
          </label>
          <button
            disabled={
              !config?.ai_enabled || !editable || !!busy || !prompt.trim()
            }
            onClick={() => generate("ai")}
          >
            {busy === "ai" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}{tr("Generate suggestion")}</button>
          <small>{tr("Trip details and saved places are sent to OpenAI when you generate. Review suggestions before applying.")}</small>
        </section>
      </div>
      {error && !proposal && (
        <div className="alert error" role="alert">
          {translateMessage(error)}
        </div>
      )}
      {proposal && (
        <Modal
          title={
            proposal.kind === "route"
              ? tr("Your route suggestion")
              : tr("Your AI suggestion")
          }
          subtitle={tr("Based on trip version {p0}", { p0: proposal.base_version })}
          onClose={() => setProposal(null)}
        >
          <p>{proposal.kind === "route" ? tr("Route suggestion using {source}. Global optimality is not guaranteed.", {source: translateMessage(proposal.metrics.source ?? "")}) : proposal.explanation}</p>
          {proposal.metrics.before_minutes !== undefined && (
            <div className="route-metrics">
              <div>
                <strong>{proposal.metrics.before_minutes}{tr(" min")}</strong>
                <small>{tr("Current travel")}</small>
              </div>
              <ArrowRight />
              <div>
                <strong>{proposal.metrics.after_minutes}{tr(" min")}</strong>
                <small>{tr("Suggested travel")}</small>
              </div>
            </div>
          )}
          <p className="field-help">{translateMessage(proposal.metrics.source ?? "")}</p>
          <div className="proposal-list">
            {proposal.operations.map((op, i) => {
              const old = trip.activities.find((a) => a.id === op.id);
              const place = trip.places.find((p) => p.id === op.place_id);
              return (
                <div key={i} className="proposal-change">
                  <span className="badge">{tr(op.kind)}</span>
                  <strong>
                    {op.title ?? old?.title ?? place?.title ?? tr("Activity")}
                  </strong>
                  <p>
                    {op.kind === "delete"
                      ? tr("Remove this activity")
                      : op.kind === "add"
                        ? tr("{p0} · {p1} · {p2} min", { p0: op.day, p1: op.start, p2: op.duration ?? place?.duration })
                        : tr("{p0} {p1} ({p2} min) → {p3} {p4} ({p5} min)", { p0: old?.day, p1: old?.start, p2: old?.duration, p3: op.day ?? old?.day, p4: op.start ?? old?.start, p5: op.duration ?? old?.duration })}
                  </p>
                  {op.kind === "update" &&
                    Object.entries(op)
                      .filter(
                        ([key, value]) =>
                          !["kind", "id", "day", "start", "duration"].includes(
                            key,
                          ) &&
                          String(value) !==
                            String(old?.[key as keyof typeof old]),
                      )
                      .map(([key, value]) => (
                        <p className="field-help" key={key}>
                          {key === "place_id" ? tr("Place") : tr(key)}:{" "}
                          {key === "place_id"
                            ? (trip.places.find((p) => p.id === old?.place_id)
                                ?.title ?? tr("None"))
                            : String(
                                old?.[key as keyof typeof old] ?? "None",
                              )}{" "}
                          →{" "}
                          {key === "place_id"
                            ? (trip.places.find((p) => p.id === value)?.title ??
                              tr("None"))
                            : String(value)}
                        </p>
                      ))}
                  {op.kind === "add" && op.notes && <small>{op.notes}</small>}
                </div>
              );
            })}
          </div>
          {stale && (
            <div className="alert error">{tr("The trip changed while this suggestion was open. Close it and generate a fresh suggestion.")}</div>
          )}
          {error && (
            <div role="alert" className="alert error">
              {translateMessage(error)}
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setProposal(null)}>{tr("Discard")}</button>
            <button disabled={!!busy || !!stale || !editable} onClick={apply}>
              {busy === "apply" ? tr("Applying…") : tr("Accept all changes")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
