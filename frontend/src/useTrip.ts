// Keep one trip synchronized, and discard its data as soon as the server revokes access.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { TripSyncSession } from "./tripSync";
import type { AccessLoss } from "./tripSync";
import type { Trip, Change } from "./types";

export function useTrip(id: string | null, onUnavailable: (id: string, reason: AccessLoss) => void) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<Change[]>([]);
  const current = useRef<TripSyncSession | null>(null);
  const accept = useCallback((next: Trip) => current.current?.accept(next), []);
  const refresh = useCallback(async () => { await current.current?.refresh(); }, []);
  const leave = useCallback(async (userId: string, version: number) => {
    const session = current.current;
    if (!id || !session?.active) return;
    await api(`/trips/${id}/members/${userId}`, "DELETE", undefined, version);
    // Capture the session before awaiting: a delayed response must never evict a different trip.
    session.revoke("left");
  }, [id]);

  useEffect(() => {
    setTrip(null);
    setEvents([]);
    setError("");
    if (!id) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let delay = 1000;
    const stopTransport = () => {
      clearInterval(poll);
      clearTimeout(retry);
      socket?.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
    const session = new TripSyncSession(id, {
      fetch: version => api(`/trips/${id}/sync?since=${version}`),
      onSnapshot: setTrip,
      onEvents: incoming => {
        // Reconnects and polling may replay events; version is the stable deduplication key.
        if (incoming.length) setEvents(prev => [...new Map(
          [...prev, ...incoming].map(event => [event.version, event]),
        ).values()].sort((a, b) => b.version - a.version).slice(0, 30));
      },
      onError: setError,
      onUnavailable: reason => {
        stopTransport();
        setTrip(null);
        setEvents([]);
        setError("");
        onUnavailable(id, reason);
      },
    });
    current.current = session;
    const load = () => { void session.refresh(); };
    const connect = () => {
      if (!session.active) return;
      setConnection(navigator.onLine ? "Connecting" : "Offline");
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trips/${id}/live`,
      );
      socket.onopen = () => {
        if (!session.active) return;
        delay = 1000;
        setConnection("Live");
        load();
      };
      socket.onmessage = event => {
        if (!session.active) return;
        try {
          const data = JSON.parse(event.data);
          // Socket messages announce changes only; HTTP snapshots independently recheck membership.
          if (data.type === "changed" || data.type === "sync") load();
        } catch { /* A malformed event never alters local data. */ }
      };
      socket.onclose = event => {
        if (!session.active) return;
        if (event.code === 1008) {
          // A policy close is authoritative. Clear the screen even if HTTP is currently unavailable.
          session.revoke();
          return;
        }
        setConnection(navigator.onLine ? "Reconnecting" : "Offline");
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
      socket.onerror = () => socket?.close();
    };
    const online = () => {
      if (!session.active) return;
      load();
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        clearTimeout(retry);
        connect();
      }
    };
    const offline = () => { if (session.active) setConnection("Offline"); };
    load();
    connect();
    // Polling remains an access check when WebSockets or Redis are unavailable.
    poll = setInterval(load, 10000);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      session.stop();
      stopTransport();
      if (current.current === session) current.current = null;
    };
  }, [id, onUnavailable]);
  // Do not show a previous trip for the render before effect cleanup runs.
  return { trip: trip?.id === id ? trip : null, accept, refresh, leave, connection, error, events };
}
