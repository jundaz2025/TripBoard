import OutsideActivities from "./components/OutsideActivities";
// Owns workspace navigation and top-level dialogs; domain writes go through the version-checked API client.
import { getLocale, tr, translateMessage } from "./i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Compass,
  Plus,
  MapPin,
  CalendarDays,
  Users,
  Sparkles,
  Hotel as HotelIcon,
  Bell,
  LogOut,
  ChevronDown,
  Settings,
  ArrowRight,
  Trash2,
  Pencil,
  Lock,
  Clock,
  Link,
  Upload,
  FileText,
  Check,
  RefreshCw,
  Menu,
  X,
  Route,
  Plane,
} from "lucide-react";
import {
  api,
  ApiError,
  message,
  days,
  dateLabel,
  endTime,
  clockLabel,
} from "./api";
import type {
  User,
  Trip,
  TripInfo,
  Transport,
  Activity,
  Place,
  Hotel,
  Config,
  Notice,
} from "./types";
import { useTrip } from "./useTrip";
import type { AccessLoss } from "./tripSync";
const MapView = lazy(() => import("./components/MapView"));
import { useLanguage } from "./useLanguage";
import LanguageSwitch from "./components/LanguageSwitch";
import TripMembers from "./components/TripMembers";
import TransferManager from "./components/TransferManager";
import Auth from "./components/Auth";
import AccountSettings from "./components/AccountSettings";
import Modal from "./components/Modal";
import Editor from "./components/Editor";
import TransportEditor from "./components/TransportEditor";
import TransportPanel from "./components/TransportPanel";
import TransportCard from "./components/TransportCard";
import { transportOnDay } from "./travel";
import { mapDayInfo } from "./mapPlan";
import { activityCoordinates, activityMapId } from "./activityLocation";
import type { LocatedActivities } from "./activityLocation";
import type { LocationResult } from "./locations";
import ActivityLocationLookup from "./components/ActivityLocationLookup";
import { humanizeTimeZones, timeZoneLabel } from "./timeZones";
import ConflictNotice from "./components/ConflictNotice";
import AssistantPanel from "./components/AssistantPanel";
import "./App.css";
const initialInvite = new URLSearchParams(location.search).get("invite") ?? "";
type Editing = {
  kind: "trip" | "activities" | "places" | "hotels";
  item?: Activity | Place | Hotel;
  newTrip?: boolean;
};
type Confirm = {
  title: string;
  detail: string;
  action: () => Promise<void>;
  label?: string;
  pendingLabel?: string;
  destructive?: boolean;
};
export default function App() {
  useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");
  const [trips, setTrips] = useState<TripInfo[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [tab, setTab] = useState("itinerary");
  const [day, setDay] = useState("");
  const [dayFocusRevision, setDayFocusRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [locatingActivity, setLocatingActivity] = useState<Activity | null>(null);
  const [locatedActivities, setLocatedActivities] = useState<LocatedActivities>({});
  const mapColumn = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [transportEditing, setTransportEditing] = useState<{item?: Transport; direction?: Transport["direction"]} | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [joinOpen, setJoinOpen] = useState(Boolean(initialInvite));
  const [joinToken, setJoinToken] = useState(initialInvite);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const unavailableTrips = useRef(new Set<string>());
  const workspaceRevision = useRef(0);
  const onTripUnavailable = useCallback((lostId: string, reason: AccessLoss) => {
    // Evict private content before any network refresh, including dialogs and cached reminders.
    unavailableTrips.current.add(lostId);
    const revision = ++workspaceRevision.current;
    setId(current => current === lostId ? null : current);
    setTrips(rows => rows.filter(row => row.id !== lostId));
    setEditing(null);
    setTransportEditing(null);
    setConfirm(null);
    setConfirmError("");
    setHistoryOpen(false);
    setTransferOpen(false);
    setNoticesOpen(false);
    setNotices(rows => rows.filter(row => row.trip_id !== lostId));
    setInvite("");
    setSelected(null);
    setLocatingActivity(null);
    setLocatedActivities({});
    setDay("");
    setTab("itinerary");
    setError("");
    setToast(reason === "left"
      ? "You left the trip. You are back in your workspace."
      : "This trip is no longer available. You are back in your workspace.");
    if (reason === "session") {
      setUser(null);
      setTrips([]);
      setNotices([]);
      setToast("");
      return;
    }
    // Refresh the sidebar without selecting a different trip or trusting an older list response.
    api<TripInfo[]>("/trips").then(rows => {
      if (workspaceRevision.current === revision) {
        setTrips(rows.filter(row => !unavailableTrips.current.has(row.id)));
      }
    }).catch(error => {
      if (workspaceRevision.current !== revision) return;
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setTrips([]);
        setNotices([]);
        setToast("");
      }
    });
  }, []);
  const { trip, accept, refresh, leave, connection, error: syncError, events } = useTrip(id, onTripUnavailable);
  const selectPlace = useCallback((next: string) => setSelected(next), []);
  // Both date controls share the itinerary selection; repeat clicks explicitly restore the day's map view.
  const selectDay = useCallback((next: string) => {
    setDay(next);
    setSelected(null);
    setDayFocusRevision(revision => revision + 1);
  }, []);
  const focusMap = useCallback((pointId: string) => {
    setSelected(pointId);
    // Every explicit Locate click restores the pin, including after panning away from the same selection.
    setDayFocusRevision(revision => revision + 1);
    const panel = mapColumn.current?.querySelector(".map-panel");
    const bounds = panel?.getBoundingClientRect();
    if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
      panel?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);
  const locatedActivity = useCallback((activityId: string, address: string, result: LocationResult) => {
    setLocatedActivities(previous => ({ ...previous, [activityId]: {
      address, coordinates: { lat: result.lat, lon: result.lon },
    } }));
    setLocatingActivity(null);
    focusMap(`activity:${activityId}`);
  }, [focusMap]);
  function locateActivity(activity: Activity) {
    if (!trip) return;
    if (activityCoordinates(activity, trip.places, locatedActivities)) focusMap(activityMapId(activity));
    else setLocatingActivity(activity);
  }
  // UI availability is a convenience; every mutation is independently authorized by the API.
  const editable = trip?.role !== "viewer" && connection !== "Offline";
  // An expired session opens login; connection failures must remain visible instead of looking like logout.
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setFatal(message(e));
      })
      .finally(() => setReady(true));
  }, []);
  // Preserve the selected trip when it still exists; deletion or joining can select a different snapshot.
  const loadTrips = useCallback(async (select?: string) => {
    const revision = workspaceRevision.current;
    const result = await api<TripInfo[]>("/trips");
    if (workspaceRevision.current !== revision) return;
    // An explicitly accepted new invitation may restore access to a previously removed trip.
    if (select && result.some(row => row.id === select)) unavailableTrips.current.delete(select);
    const rows = result.filter(row => !unavailableTrips.current.has(row.id));
    setTrips(rows);
    setId(
      (current) =>
        select ??
        (rows.some((t) => t.id === current) ? current : (rows[0]?.id ?? null)),
    );
  }, []);
  useEffect(() => {
    if (!user) return;
    // Revoked memberships belong to this login, never to another account using the same browser.
    unavailableTrips.current.clear();
    workspaceRevision.current += 1;
    loadTrips().catch((e) => setError(message(e)));
    api<Config>("/config")
      .then(setConfig)
      .catch((e) => setError(message(e)));
    const load = () => {
      const revision = workspaceRevision.current;
      return api<Notice[]>("/notifications")
        .then(rows => {
          if (workspaceRevision.current === revision) {
            setNotices(rows.filter(row => !unavailableTrips.current.has(row.trip_id)));
          }
        })
        .catch(() => {});
    };
    load();
    // Notifications have their own polling lifecycle, separate from the currently selected trip socket.
    const timer = setInterval(load, 20000);
    return () => {
      clearInterval(timer);
      workspaceRevision.current += 1;
    };
  }, [user, loadTrips]);
  // Reflect live changes in the sidebar and keep the selected day inside an edited trip date range.
  useEffect(() => {
    if (trip) {
      setDay((d) =>
        d >= trip.start_date && d <= trip.end_date ? d : trip.start_date,
      );
      setTrips((rows) =>
        rows.map((t) =>
          t.id === trip.id
            ? {
                ...t,
                title: trip.title,
                destination: trip.destination,
                version: trip.version,
                role: trip.role,
                start_date: trip.start_date,
                end_date: trip.end_date,
                timezone: trip.timezone,
              }
            : t,
        ),
      );
    }
  }, [trip]);
  useEffect(() => {
    setSelected(null);
    setLocatingActivity(null);
    setLocatedActivities({});
    setInvite("");
    setTransferOpen(false);
    setTab("itinerary");
  }, [id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  // Keep confirmation failures local so one operation cannot leak errors into another dialog.
  function openConfirm(next: Confirm) {
    setConfirmError("");
    setConfirm(next);
  }
  async function run(action: () => Promise<void>, onError = setError) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  // Editors pass their captured version so live updates cannot silently authorize overwriting a newer plan.
  async function saved(data: Record<string, unknown>, v?: number) {
    if (!editing) return;
    if (editing.kind === "trip") {
      const next = await api<Trip>(
        editing.newTrip ? "/trips" : `/trips/${trip?.id}`,
        editing.newTrip ? "POST" : "PUT",
        data,
        v,
      );
      if (editing.newTrip) await loadTrips(next.id);
      else accept(next);
    } else {
      const path =
        `/trips/${trip?.id}/items/${editing.kind}` +
        (editing.item ? "/" + editing.item.id : "");
      accept(await api(path, editing.item ? "PUT" : "POST", data, v));
    }
    setToast("Saved. Your trip is up to date.");
  }
  function requestTripDeletion() {
    if (!trip || trip.role !== "owner") return;
    // Freeze the reviewed trip/version when opening confirmation, even if a live update arrives later.
    const tid = trip.id, version = trip.version;
    setError("");
    openConfirm({
      title: `Delete "${trip.title}"?`,
      detail: "This permanently deletes the trip, activities, saved places, reservations and shared access for everyone. This cannot be undone.",
      label: "Delete trip",
      action: async () => {
        await api(`/trips/${tid}`, "DELETE", undefined, version);
        setConfirm(null);
        await loadTrips();
      },
    });
  }
  function removeItem(
    kind: string,
    item: { id: string; title?: string; name?: string },
  ) {
    if (!trip) return;
    const tid = trip.id,
      v = trip.version;
    openConfirm({
      title: `Delete ${item.title ?? item.name}?`,
      detail: "This removes it from the shared trip for everyone.",
      action: async () => {
        accept(
          await api(
            `/trips/${tid}/items/${kind}/${item.id}`,
            "DELETE",
            undefined,
            v,
          ),
        );
        setConfirm(null);
      },
    });
  }
  async function join(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const token = joinToken.includes("?invite=")
        ? new URL(joinToken).searchParams.get("invite")
        : joinToken.trim();
      const joined = await api<{ id: string }>("/invites/join", "POST", {
        token,
      });
      await loadTrips(joined.id);
      setJoinOpen(false);
      setJoinToken("");
      // Remove the consumed invitation token from the address bar after membership has been confirmed.
      history.replaceState({}, "", location.pathname);
      setToast("You joined the trip.");
    });
  }
  const todays =
    trip?.activities
      .filter((a) => a.day === day)
      .sort((a, b) => a.start.localeCompare(b.start)) ?? [];
  // Conflict day metadata is computed in the trip zone, including travel that crosses midnight.
  const dailyConflicts = trip?.conflicts.filter(c => !c.days || c.days.includes(day)) ?? [];
  const dailyTravel = (trip?.transports ?? []).filter(leg => trip && day && transportOnDay(leg, day, trip.timezone)).sort((a,b) => a.departure_at.localeCompare(b.departure_at));
  if (!ready)
    return (
      <div className="loading-page">
        <Compass className="spin" />{tr("Opening TripBoard…")}</div>
    );
  if (fatal)
    return (
      <div className="loading-page">
        <h2>{tr("We could not reach the backend.")}</h2>
        <p>{translateMessage(fatal)}</p>
        <button onClick={() => location.reload()}>{tr("Try again")}</button>
      </div>
    );
  if (!user) return <Auth onUser={setUser} />;
  return (
    <div className="app-shell">
      <aside className={"sidebar" + (sidebar ? " open" : "")}>
        <a className="brand" href="/" onClick={(e) => e.preventDefault()}>
          <Compass size={27} />{tr("tripboard")}<span>®</span>
        </a>
        <button
          className="sidebar-close icon-button"
          aria-label={tr("Close menu")}
          onClick={() => setSidebar(false)}
        >
          <X />
        </button>
        <div className="workspace-label">{tr("YOUR WORKSPACE")}</div>
        <button
          className="workspace-button"
          onClick={() => setTab("itinerary")}
        >
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span>
            {user.name}{tr("'s travels")}<small>{tr("Make something memorable")}</small>
          </span>
        </button>
        <div className="sidebar-label">{tr("MY TRIPS")}<button
            className="icon-button"
            aria-label={tr("Create trip")}
            onClick={() => setEditing({ kind: "trip", newTrip: true })}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="trip-nav">
          {trips.map((t) => (
            <button
              className={id === t.id ? "active" : ""}
              key={t.id}
              onClick={() => {
                setId(t.id);
                setSidebar(false);
                setEditing(null);
              }}
            >
              <MapPin size={17} />
              <span>
                {t.title}
                <small>{t.destination}</small>
              </span>
              {id === t.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <button
          className="new-trip secondary"
          onClick={() => setEditing({ kind: "trip", newTrip: true })}
        >
          <Plus size={16} />{tr("New trip")}</button>
        <button className="text-button" onClick={() => setJoinOpen(true)}>
          <Link size={15} />{tr("Join with an invitation")}</button>
        <div className="sidebar-note">
          <Route size={23} />
          <h4>{tr("The best plans leave room.")}</h4>
          <p>{tr("Save your must-sees. Make time for the unexpected.")}</p>
        </div>
        <button
          className="account-button secondary"
          onClick={() => setAccountOpen(true)}
        >
          <Settings size={16} />{tr("Account settings")}</button>
        <div className="user-bottom">
          <span className="avatar small">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {user.name}
            <small>{user.email}</small>
          </span>
          <button
            className="icon-button"
            aria-label={tr("Sign out")}
            onClick={() => {
              setError("");
              openConfirm({
                title: "Sign out?",
                detail: "Are you sure you want to sign out of your account?",
                label: "Sign out",
                pendingLabel: "Signing out…",
                destructive: false,
                action: async () => {
                  await api("/auth/logout", "POST");
                  setConfirm(null);
                  setId(null);
                  setTrips([]);
                  setUser(null);
                  setNotices([]);
                  setToast("");
                },
              });
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label={tr("Open menu")}
              onClick={() => setSidebar(true)}
            >
              <Menu />
            </button>
            <span>{tr("My workspace")}</span>
            <span>/</span>
            <strong>{trip?.title ?? tr("Your trips")}</strong>
          </div>
          <div className="top-actions">
            <LanguageSwitch />
            {trip && (
              <button
                className="connection"
                onClick={() => run(refresh)}
                title={tr("Refresh shared trip")}
              >
                <span
                  className={
                    "live-dot " + (connection === "Live" ? "" : "muted")
                  }
                />
                {tr(connection)}
              </button>
            )}
            <button
              className="icon-button notification-button"
              aria-label={tr("Open reminders")}
              onClick={() => setNoticesOpen(true)}
            >
              <Bell size={19} />
              {notices.some((n) => !n.read) && <i />}
            </button>
            <span className="avatar small">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          {(error || syncError) && (
            <div className="alert error page-alert" role="alert">
              {translateMessage(error || syncError)}
              <button
                className="text-button"
                onClick={() => {
                  setError("");
                  run(refresh);
                }}
              >
                <RefreshCw size={15} />{tr("Refresh trip")}</button>
            </div>
          )}
          {!id && (
            <div className="empty-workspace">
              <span className="feature-icon">
                <Compass size={34} />
              </span>
              <p className="eyebrow">{tr("A WORLD OF POSSIBILITIES")}</p>
              <h1>{tr(trips.length ? "Your trips" : "Where are we going?")}</h1>
              {trips.length ? <p>{tr("Choose a trip from the sidebar, or start a new adventure.")}</p> : <p>{tr("Give your next adventure a home.")}<br />{tr("Plan the days, save the little details, and invite your people.")}</p>}
              <button
                onClick={() => setEditing({ kind: "trip", newTrip: true })}
              >
                <Plus size={17} />{tr(trips.length ? "New trip" : "Create your first trip")}</button>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    const demo = await api<Trip>("/demo", "POST");
                    await loadTrips(demo.id);
                  })
                }
              >{tr("Explore a sample Boston trip")}<ArrowRight size={16} />
              </button>
            </div>
          )}
          {id && !trip && !syncError && (
            <div className="loading-page">{tr("Loading your trip…")}</div>
          )}
          {trip && (
            <>
              <section className="trip-hero">
                <div>
                  <p className="eyebrow">{tr("LET'S GO SOMEWHERE")}</p>
                  <h1>{trip.title}</h1>
                  <div className="trip-meta">
                    <span>
                      <MapPin size={15} />
                      {trip.destination}
                    </span>
                    <span>
                      <CalendarDays size={15} />
                      {dateLabel(trip.start_date)} — {dateLabel(trip.end_date)}
                    </span>
                    <span>
                      <Clock size={15} />
                      {timeZoneLabel(trip.timezone)}
                    </span>
                  </div>
                </div>
                <div className="hero-actions">
                  <TripMembers key={trip.id} members={trip.members} currentUserId={user.id}
                    onViewMembers={() => setTab("team")} />
                  <button className="secondary" onClick={() => setTab("team")}>
                    <Users size={16} />
                    {trip.role === "owner" ? tr("Invite friends") : tr("Trip members")}
                  </button>
                  {trip.role === "owner" && (
                    <button className="secondary danger" onClick={requestTripDeletion}>
                      <Trash2 size={16} />{tr(" Delete trip")}</button>
                  )}
                  {editable && (
                    <button
                      className="icon-button bordered"
                      aria-label={tr("Trip settings")}
                      onClick={() => setEditing({ kind: "trip" })}
                    >
                      <Settings size={19} />
                    </button>
                  )}
                </div>
              </section>
              <nav className="tabbar">
                {[
                  { key: "itinerary", label: "Itinerary", icon: CalendarDays },
                  { key: "places", label: "Saved places", icon: MapPin },
                  {
                    key: "travel-stays",
                    label: "Travel & stays",
                    icon: Plane,
                  },
                  {
                    key: "assistant",
                    label: "Planning assistant",
                    icon: Sparkles,
                  },
                  { key: "team", label: "People", icon: Users },
                ].map((t) => (
                  <button
                    className={tab === t.key ? "active" : ""}
                    key={t.key}
                    onClick={() => setTab(t.key)}
                  >
                    <t.icon size={17} />
                    {tr(t.label)}
                    {t.key === "places" && (
                      <span className="count">{trip.places.length}</span>
                    )}
                  </button>
                ))}
              </nav>
              {trip.role === "viewer" && (
                <div className="alert neutral page-alert">{tr("You have view-only access to this trip.")}</div>
              )}
              {tab === "itinerary" && (
                <>
                  <div className="daybar">
                    <div className="day-tabs">
                      {days(trip.start_date, trip.end_date).map((d, i) => (
                        <button
                          className={day === d ? "active" : ""}
                          key={d}
                          aria-pressed={day === d}
                          onClick={() => selectDay(d)}
                        >
                          <small><i className="day-color-dot" style={{ backgroundColor: mapDayInfo(d, trip.start_date).color }} aria-hidden="true" />{tr("Day {number}", { number: i + 1 })}</small>
                          {dateLabel(d)}
                        </button>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setTab("assistant")}
                    >
                      <Route size={17} />{tr("Optimize day")}<ArrowRight size={15} />
                    </button>
                  </div>
                  <OutsideActivities key={trip.id} trip={trip} editable={editable} onSaved={accept} onEdit={activity => setEditing({ kind: "activities", item: activity })} />
                  <div className="planner-grid">
                    <div className="itinerary-panel">
                      <div className="section-heading">
                        <div>
                          <h2>{day ? dateLabel(day, true) : tr("Your day")}</h2>
                          <p>{tr("{count} stops", {count: todays.length})} · {dailyTravel.length ? tr(dailyTravel.length === 1 ? "{count} travel leg" : "{count} travel legs", {count: dailyTravel.length}) : tr("A day to make your own")}</p>
                        </div>
                        {editable && (
                          <button
                            className="secondary compact"
                            onClick={() => setEditing({ kind: "activities" })}
                          >
                            <Plus size={16} />{tr("Add activity")}</button>
                        )}
                      </div>
                      <ConflictNotice conflicts={dailyConflicts} />
                      {dailyTravel.length > 0 && <section className="daily-travel"><h3>{tr("Travel today")}</h3><small>{tr("Journeys shown on this day in ")}{timeZoneLabel(trip.timezone)}{tr(". Each endpoint shows its local time.")}</small>{dailyTravel.map(leg => <TransportCard key={leg.id} leg={leg} editable={editable} onEdit={() => setTransportEditing({item: leg})} onDelete={() => removeItem("transports", leg)} />)}</section>}
                      {!todays.length && !dailyTravel.length && (
                        <div className="empty-card">
                          <CalendarDays size={30} />
                          <h3>{tr("A little space for possibility.")}</h3>
                          <p>{tr("Add an activity, or save a few places and let the planning assistant help.")}</p>
                          {editable && (
                            <button
                              className="secondary"
                              onClick={() => setEditing({ kind: "activities" })}
                            >
                              <Plus size={16} />{tr("Plan your first stop")}</button>
                          )}
                        </div>
                      )}
                      <div className="timeline">
                        {todays.map((a, i) => (
                          <article
                            key={a.id}
                            className={
                              "activity-card" +
                              (selected === activityMapId(a)
                                ? " selected"
                                : "")
                            }
                          >
                            <div className="time-rail">
                              <strong>{a.start}</strong>
                              <span>{endTime(a.start, a.duration)}</span>
                              <i>{i + 1}</i>
                            </div>
                            <div className="activity-content">
                              <div className="activity-top">
                                <span className="badge">
                                  {tr(trip.places.find((p) => p.id === a.place_id)?.category ?? "Activity")}
                                </span>
                                {a.locked && (
                                  <span className="locked">
                                    <Lock size={12} />{tr("Fixed")}</span>
                                )}
                              </div>
                              <h3>{a.title}</h3>
                              <p className="location-line">
                                <MapPin size={13} />
                                {a.location || tr("Location not added")}
                              </p>
                              {a.notes && (
                                <p className="activity-notes">{a.notes}</p>
                              )}
                              <div className="activity-footer">
                                <span>
                                  <Clock size={13} />
                                  {a.duration}{tr(" min")}</span>
                                {a.reminder_minutes !== null && (
                                  <span>
                                    <Bell size={13} />
                                    {a.reminder_minutes === 0
                                      ? tr("At start")
                                      : tr("{p0}m before", { p0: a.reminder_minutes })}
                                  </span>
                                )}
                                <div className="card-actions">
                                  <button className="text-button"
                                    aria-label={tr("Locate {p0} on map", { p0: a.title })}
                                    onClick={() => locateActivity(a)}>
                                    <MapPin size={14} />{tr("Locate on map")}
                                  </button>
                                  {editable && (
                                    <>
                                      <button
                                        className="icon-button"
                                        aria-label={tr("Edit {p0}", { p0: a.title })}
                                        onClick={() =>
                                          setEditing({
                                            kind: "activities",
                                            item: a,
                                          })
                                        }
                                      >
                                        <Pencil size={15} />
                                      </button>
                                      <button
                                        className="icon-button danger"
                                        aria-label={tr("Delete {p0}", { p0: a.title })}
                                        onClick={() =>
                                          removeItem("activities", a)
                                        }
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                      {todays.length > 0 && (
                        <p className="end-of-day">{tr("✦ A good day, with room to wander.")}</p>
                      )}
                    </div>
                    <div className="map-column" ref={mapColumn}>
                      <Suspense
                        fallback={
                          <div className="map-panel loading-page">{tr("Loading map…")}</div>
                        }
                      >
                        <MapView
                          key={trip.id}
                          trip={trip}
                          editable={editable}
                          onSaved={accept}
                          day={day}
                          selected={selected}
                          onSelect={selectPlace}
                          onSelectDay={selectDay}
                          focusRevision={dayFocusRevision}
                          locatedActivities={locatedActivities}
                        />
                      </Suspense>
                      <div className="map-bottom">
                        <Compass size={20} />
                        <div>
                          <strong>{tr("Small details. Better adventures.")}</strong>
                          <p>{tr("Tap a stop to find it on the map.")}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {tab === "places" && (
                <section className="content-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">{tr("YOUR SHORTLIST")}</p>
                      <h2>{tr("Places worth a detour.")}</h2>
                      <p>{tr("Saved coordinates and hours power maps, routes and AI suggestions.")}</p>
                    </div>
                    {editable && (
                      <button onClick={() => setEditing({ kind: "places" })}>
                        <Plus size={16} />{tr("Save a place")}</button>
                    )}
                  </div>
                  <div className="item-grid">
                    {trip.places.map((p) => (
                      <article className="card place-card" key={p.id}>
                        <span className="feature-icon">
                          <MapPin size={24} />
                        </span>
                        <span className="badge">{tr(p.category)}</span>
                        <h3>{p.title}</h3>
                        <p>{p.location}</p>
                        <div className="place-meta">
                          <span>
                            {p.hours_confirmed === false
                              ? tr("Opening hours not set")
                              : tr("{p0}–{p1}", { p0: p.opens, p1: p.closes })}
                          </span>
                          <span>{p.duration}{tr(" min visit")}</span>
                        </div>
                        {p.notes && <p>{p.notes}</p>}
                        <small>{tr("Hours are manually saved. Verify them before your visit.")}</small>
                        <div className="card-bottom">
                          <button
                            className="text-button"
                            onClick={() => {
                              setTab("itinerary");
                              setSelected(p.id);
                            }}
                          >{tr("View on map")}<ArrowRight size={14} />
                          </button>
                          {editable && (
                            <>
                              <button
                                className="icon-button"
                                aria-label={tr("Edit {p0}", { p0: p.title })}
                                onClick={() =>
                                  setEditing({ kind: "places", item: p })
                                }
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon-button danger"
                                aria-label={tr("Delete {p0}", { p0: p.title })}
                                onClick={() => removeItem("places", p)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!trip.places.length && (
                    <div className="empty-card">
                      <MapPin size={30} />
                      <h3>{tr("Your shortlist starts here.")}</h3>
                      <p>{tr("Search for a location or enter its coordinates.")}</p>
                    </div>
                  )}
                </section>
              )}
              {tab === "travel-stays" && (
                <section className="content-section travel-stays-page">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">{tr("THERE, HERE & BACK")}</p>
                      <h2>{tr("Travel & stays")}</h2>
                      <p>{tr("Your journeys and hotel reservations, together in one place.")}</p>
                      <p>{tr("Travel times are local to each departure or arrival city.")}</p>
                    </div>
                  </div>
                  <ConflictNotice conflicts={trip.conflicts.filter(c => c.items?.some(item => item.kind === "transport"))} />
                  <TransportPanel trip={trip} direction="outbound" editable={editable} onAdd={direction => setTransportEditing({direction})} onEdit={item => setTransportEditing({item})} onDelete={item => removeItem("transports", item)} />
                  <section className="stay-group" aria-label={tr("Where you're staying")}>
                    <div className="section-heading">
                      <div>
                        <h3>{tr("Where you're staying")}</h3>
                        <p>{tr("Existing bookings, confirmation files and the details you need.")}</p>
                      </div>
                      {editable && (
                        <button onClick={() => setEditing({ kind: "hotels" })}>
                          <Plus size={16} />{tr("Add reservation")}</button>
                      )}
                    </div>
                    <div className="item-grid">
                      {trip.hotels.map((h) => (
                        <article className="card hotel-card" key={h.id}>
                          <span className="feature-icon gold">
                            <HotelIcon size={24} />
                          </span>
                          <h3>{h.name}</h3>
                          <p>{h.address}</p>
                          <div className="hotel-dates">
                            <div>
                              <small>{tr("CHECK-IN")}</small>
                              <strong>{dateLabel(h.check_in)}</strong>
                              <span>{clockLabel(h.check_in_time)}</span>
                            </div>
                            <ArrowRight size={18} />
                            <div>
                              <small>{tr("CHECK-OUT")}</small>
                              <strong>{dateLabel(h.check_out)}</strong>
                              <span>{clockLabel(h.check_out_time)}</span>
                            </div>
                          </div>
                          {h.notes && <p>{h.notes}</p>}
                          {h.link && (
                            <a
                              className="text-button"
                              href={h.link}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Link size={15} />{tr("Open reservation")}</a>
                          )}
                          <div className="documents">
                            {trip.documents
                              .filter((d) => d.hotel_id === h.id)
                              .map((d) => (
                                <a key={d.id} href={"/api/documents/" + d.id}>
                                  <FileText size={15} />
                                  {d.name}
                                </a>
                              ))}
                          </div>
                          <div className="card-bottom">
                            {editable && (
                              <>
                                <label className="upload-button">
                                  <Upload size={15} />{tr("Confirmation")}<input
                                    type="file"
                                    accept="application/pdf,image/png,image/jpeg"
                                    disabled={busy}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (!f) return;
                                      const fd = new FormData();
                                      fd.append("file", f);
                                      run(async () =>
                                        accept(
                                          await api(
                                            `/trips/${trip.id}/hotels/${h.id}/documents`,
                                            "POST",
                                            fd,
                                            trip.version,
                                          ),
                                        ),
                                      );
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                                <button
                                  className="icon-button"
                                  aria-label={tr("Edit {p0}", { p0: h.name })}
                                  onClick={() =>
                                    setEditing({ kind: "hotels", item: h })
                                  }
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  className="icon-button danger"
                                  aria-label={tr("Delete {p0}", { p0: h.name })}
                                  onClick={() => removeItem("hotels", h)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                          <small>{tr("PDF, PNG or JPEG · up to 10 MB")}</small>
                        </article>
                      ))}
                    </div>
                    {!trip.hotels.length && (
                      <div className="empty-card">
                        <HotelIcon size={30} />
                        <h3>{tr("Keep your booking close.")}</h3>
                        <p>{tr("Add an existing hotel reservation. TripBoard does not sell hotel stays.")}</p>
                      </div>
                    )}
                  </section>
                  <TransportPanel trip={trip} direction="return" editable={editable} onAdd={direction => setTransportEditing({direction})} onEdit={item => setTransportEditing({item})} onDelete={item => removeItem("transports", item)} />
                </section>
              )}
              {tab === "assistant" && (
                <AssistantPanel
                  key={trip.id + day}
                  trip={trip}
                  config={config}
                  day={day}
                  onApply={accept}
                />
              )}
              {tab === "team" && (
                <section className="content-section team-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">{tr("BETTER TOGETHER")}</p>
                      <h2>{tr("Your travel crew.")}</h2>
                      <p>{tr("One Manager leads the trip. Editors plan together. Viewers can follow along.")}</p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setHistoryOpen(true)}
                    >
                      <Clock size={16} />{tr("Change history")}</button>
                  </div>
                  <div className="card member-list">
                    {trip.members.map((m, i) => (
                      <div className="member-row" key={m.id}>
                        <span className={"avatar tone-" + (i % 4)}>
                          {m.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>
                            {m.name}
                            {m.id === user.id ? tr(" (you)") : ""}
                          </strong>
                          <small>{m.email}</small>
                        </div>
                        {trip.role === "owner" && m.role !== "owner" ? (
                          <>
                            <select
                              aria-label={tr("Role for {p0}", { p0: m.name })}
                              value={m.role}
                              disabled={busy}
                              onChange={(e) =>
                                run(async () => {
                                  await api(
                                    `/trips/${trip.id}/members/${m.id}`,
                                    "PUT",
                                    { role: e.target.value },
                                    trip.version,
                                  );
                                  await refresh();
                                })
                              }
                            >
                              <option value="editor">{tr("Editor")}</option>
                              <option value="viewer">{tr("Viewer")}</option>
                            </select>
                            <button
                              className="icon-button danger"
                              aria-label={tr("Remove {p0}", { p0: m.name })}
                              onClick={() => {
                                const version = trip.version;
                                openConfirm({
                                  title: `Remove ${m.name}?`,
                                  detail:
                                    "He/she will lose access to this shared trip.",
                                  action: async () => {
                                    await api(
                                      `/trips/${trip.id}/members/${m.id}`,
                                      "DELETE",
                                      undefined,
                                      version,
                                    );
                                    await refresh();
                                    setConfirm(null);
                                  },
                                });
                              }}
                            >
                              <X size={17} />
                            </button>
                          </>
                        ) : (
                          <span className="badge">{tr(m.role === "owner" ? "Manager" : m.role)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {trip.role === "owner" && (
                    <div className="card manager-card">
                      <div>
                        <h3>{tr("Trip management")}</h3>
                        <p>{tr("To leave this trip, transfer the Manager role to another member first.")}</p>
                        {trip.members.length < 2 && <p>{tr("Invite someone to join before transferring management.")}</p>}
                      </div>
                      <button className="secondary" disabled={busy || connection === "Offline" || trip.members.length < 2}
                        onClick={() => setTransferOpen(true)}>{tr("Transfer manager")}</button>
                    </div>
                  )}
                  {trip.role === "owner" && (
                    <div className="card invite-card">
                      <h3>{tr("Bring a friend.")}</h3>
                      <p>{tr("Create a single-use invitation, valid for 24 hours. Send it to your friend yourself.")}</p>
                      <div className="search-row">
                        <select
                          aria-label={tr("Invitation role")}
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value)}
                        >
                          <option value="editor">{tr("Can edit")}</option>
                          <option value="viewer">{tr("Can view")}</option>
                        </select>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const r = await api<{ token: string }>(
                                `/trips/${trip.id}/invites`,
                                "POST",
                                { role: inviteRole },
                              );
                              setInvite(
                                location.origin + "/?invite=" + r.token,
                              );
                            })
                          }
                        >
                          <Link size={16} />{tr("Create invite link")}</button>
                      </div>
                      {invite && (
                        <div className="invite-result">
                          <input
                            aria-label={tr("Invitation link")}
                            readOnly
                            value={invite}
                          />
                          <button
                            className="secondary"
                            onClick={() =>
                              run(async () => {
                                await navigator.clipboard.writeText(invite);
                                setToast("Invitation copied.");
                              })
                            }
                          >{tr("Copy link")}</button>
                        </div>
                      )}
                    </div>
                  )}
                  {trip.role === "owner" && (
                    <button
                      className="text-button danger"
                      onClick={requestTripDeletion}
                    >
                      <Trash2 size={15} />{tr("Delete trip")}</button>
                  )}
                  {trip.role !== "owner" && (
                    <button
                      className="secondary danger"
                      disabled={busy || connection === "Offline"}
                      onClick={() => openConfirm({
                        title: "Leave trip?",
                        detail: "You will lose access to this trip and need a new invitation to rejoin. The trip and everyone's plans will stay.",
                        label: "Leave trip",
                        pendingLabel: "Leaving…",
                        action: () => leave(user.id, trip.version),
                      })}
                    >
                      <LogOut size={16} />{tr("Leave trip")}
                    </button>
                  )}
                </section>
              )}
              <footer className="workspace-footer">
                <span>
                  <Compass size={13} />{tr("Made for the journey.")}</span>
                <button
                  className="text-button"
                  onClick={() => setHistoryOpen(true)}
                >{tr("Version ")}{trip.version}
                  <ChevronDown size={12} />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {translateMessage(toast)}
        </div>
      )}
      {accountOpen && (
        <AccountSettings
          user={user}
          onClose={() => setAccountOpen(false)}
          onDeleted={() => {
            setAccountOpen(false);
            setId(null);
            setTrips([]);
            setUser(null);
            setNotices([]);
            setToast("");
          }}
        />
      )}
      {transportEditing && trip && <TransportEditor trip={trip} item={transportEditing.item} direction={transportEditing.direction} onClose={() => setTransportEditing(null)} onSave={async (data, version) => {
        const item = transportEditing.item;
        accept(await api<Trip>(`/trips/${trip.id}/items/transports` + (item ? `/${item.id}` : ""), item ? "PUT" : "POST", data, version));
        setToast("Travel saved. Your trip is up to date.");
      }} />}
      {locatingActivity && trip && <ActivityLocationLookup
        key={`${trip.id}:${locatingActivity.id}:${locatingActivity.location}`}
        trip={trip} activity={locatingActivity} onLocate={locatedActivity}
        onClose={() => setLocatingActivity(null)} />}
      {transferOpen && trip?.role === "owner" && <TransferManager key={trip.id} trip={trip}
        onClose={() => setTransferOpen(false)} onTransferred={next => {
          accept(next);
          setTransferOpen(false);
          setInvite("");
          setToast("Manager transferred. You are now an Editor and can leave from People.");
        }} />}
      {editing && (editing.newTrip || trip) && (
        <Editor
          kind={editing.kind}
          trip={editing.newTrip ? null : trip}
          item={editing.item}
          day={day}
          onSave={saved}
          onClose={() => setEditing(null)}
        />
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>{translateMessage(confirm.detail)}</p>
          {confirmError && (
            <div role="alert" className="alert error">
              {translateMessage(confirmError)}
            </div>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >{tr("Cancel")}</button>
            <button
              className={confirm.destructive === false ? undefined : "danger-button"}
              disabled={busy}
              onClick={() => run(confirm.action, setConfirmError)}
            >
              {busy
                ? tr(confirm.pendingLabel ?? "Deleting…")
                : tr(confirm.label ?? "Confirm deletion")}
            </button>
          </div>
        </Modal>
      )}
      {joinOpen && (
        <Modal
          title={tr("Join your people.")}
          subtitle={tr("Paste the invitation link or token you received.")}
          onClose={() => setJoinOpen(false)}
        >
          <form onSubmit={join}>
            <label>{tr("Invitation")}<input
                value={joinToken}
                onChange={(e) => setJoinToken(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="alert error" role="alert">
                {translateMessage(error)}
              </div>
            )}
            <div className="modal-actions">
              <button disabled={busy}>{tr("Join trip")}<ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {noticesOpen && (
        <Modal
          title={tr("Your reminders")}
          subtitle={tr("Activity and hotel reminders stay here, even after a restart.")}
          onClose={() => setNoticesOpen(false)}
        >
          {!notices.length && (
            <div className="empty-card">
              <Bell size={25} />
              <h3>{tr("All caught up.")}</h3>
              <p>{tr("Due reminders appear here while the reminder worker is running.")}</p>
            </div>
          )}
          {notices.map((n) => (
            <button
              className={"notice " + (!n.read ? "unread" : "")}
              key={n.id}
              onClick={() =>
                run(async () => {
                  await api(`/notifications/${n.id}/read`, "POST");
                  setNotices((prev) =>
                    prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
                  );
                  setId(n.trip_id);
                  setNoticesOpen(false);
                })
              }
            >
              <Bell size={17} />
              <span>
                {humanizeTimeZones(translateMessage(n.message))}
                <small>{new Date(n.created_at).toLocaleString(getLocale())}</small>
              </span>
            </button>
          ))}
        </Modal>
      )}
      {historyOpen && (
        <Modal
          title={tr("Shared change history")}
          subtitle={tr("Persisted changes are replayed when you reconnect.")}
          onClose={() => setHistoryOpen(false)}
        >
          {events.map((e) => (
            <div className="history-row" key={e.version}>
              <span className="badge">{tr("v")}{e.version}</span>
              <div>
                <strong>{e.actor}</strong>
                <p>{e.kind.split(".").map(part => tr(part.replaceAll("_", " "))).join(" · ")}</p>
                <small>{new Date(e.created_at).toLocaleString(getLocale())}</small>
              </div>
            </div>
          ))}
          {!events.length && <p>{tr("No recent changes.")}</p>}
        </Modal>
      )}
    </div>
  );
}
