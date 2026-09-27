// Keeps one selected trip synchronized through authoritative snapshots, WebSocket wake-ups and polling fallback.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import type { Trip, Change } from "./types";
export function useTrip(id: string | null) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<Change[]>([]);
  const version = useRef(0);
  const active = useRef(id);
  const accept = useCallback((next: Trip) => {
    // Ignore late responses from a previous trip and snapshots older than an accepted version.
    if (next.id !== active.current || next.version <= version.current) return;
    version.current = next.version;
    setTrip(next);
  }, []);
  const refresh = useCallback(async () => {
    if (!id) return;
    const result = await api<{ snapshot: Trip; events: Change[] }>(
      `/trips/${id}/sync?since=${version.current}`,
    );
    if (active.current !== id) return;
    accept(result.snapshot);
    setError("");
    // Reconnects and polling may replay events; version is the stable deduplication key.
    if (result.events.length)
      setEvents((prev) =>
        [
          ...new Map(
            [...prev, ...result.events].map((e) => [e.version, e]),
          ).values(),
        ]
          .sort((a, b) => b.version - a.version)
          .slice(0, 30),
      );
  }, [id, accept]);
  useEffect(() => {
    active.current = id;
    version.current = 0;
    setTrip(null);
    setEvents([]);
    setError("");
    if (!id) return;
    let closed = false,
      socket: WebSocket | null = null,
      retry: ReturnType<typeof setTimeout>,
      delay = 1000;
    const load = () =>
      refresh().catch((e) => {
        if (!closed) setError(message(e));
      });
    const connect = () => {
      if (closed) return;
      setConnection(navigator.onLine ? "Connecting" : "Offline");
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trips/${id}/live`,
      );
      socket.onopen = () => {
        delay = 1000;
        setConnection("Live");
        load();
      };
      socket.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          // Socket messages announce change only. Fetching a snapshot keeps recovery idempotent.
          if (data.type === "changed" || data.type === "sync") load();
        } catch {
          /* A malformed event never alters local data. */
        }
      };
      socket.onclose = (e) => {
        if (closed) return;
        setConnection(navigator.onLine ? "Reconnecting" : "Offline");
        if (e.code === 1008) {
          setError(
            "Access changed or your session expired. Refresh the page to sign in again.",
          );
          return;
        }
        // Back off after disconnects instead of creating a tight reconnect loop.
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
      socket.onerror = () => socket?.close();
    };
    load();
    connect();
    // Periodic sync repairs missed Pub/Sub messages and remains useful when Redis is unavailable.
    const poll = setInterval(load, 10000);
    const online = () => {
      load();
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        clearTimeout(retry);
        connect();
      }
    };
    const offline = () => setConnection("Offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      // Dispose all timers/listeners so switching trips cannot leave a second synchronization loop running.
      closed = true;
      clearInterval(poll);
      clearTimeout(retry);
      socket?.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [id, refresh]);
  return { trip, accept, refresh, connection, error, events };
}
