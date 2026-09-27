// Resolves a destination once and ignores late responses after the user switches cities or trips.
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { LocationResult } from "./locations";

type Result = {
  query: string;
  location: LocationResult | null;
  error: string;
};
const lookups = new Map<
  string,
  { expires: number; promise: Promise<LocationResult | null> }
>();

// Share in-flight requests across StrictMode and remounts. Redis also caches
// results across users; only a saved destination triggers this lookup.
function locate(query: string): Promise<LocationResult | null> {
  const cached = lookups.get(query);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const rows = await api<LocationResult[]>(
          "/places/search?city_only=true&q=" + encodeURIComponent(query),
        );
        return rows[0] ?? null;
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 429 ||
          attempt >= 2
        )
          throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 2100));
      }
    }
  })();
  if (lookups.size >= 100) lookups.clear();
  lookups.set(query, { expires: Date.now() + 10 * 60_000, promise });
  void promise.catch(() => lookups.delete(query));
  return promise;
}

export function useDestination(destination: string, enabled: boolean, selected?: LocationResult | null) {
  const query = destination.trim().replace(/\s+/g, " ").toLowerCase();
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || selected || query.length < 3) return;
    let active = true;
    locate(query).then(
      (location) => {
        if (active) setResult({ query, location, error: "" });
      },
      () => {
        if (active)
          setResult({
            query,
            location: null,
            error:
              "We couldn't load this destination. Try again or update Destination in Trip settings.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [query, enabled, attempt, selected]);

  const current = result?.query === query ? result : null;
  return {
    location: enabled ? (selected ?? current?.location ?? null) : null,
    loading: enabled && !selected && query.length >= 3 && !current,
    error: !enabled || selected
      ? ""
      : query.length < 3
        ? "Enter a city and country in Trip settings to center your map."
        : current?.error ||
          (current && !current.location
            ? "We couldn't find this city. Add a country to Destination in Trip settings."
            : ""),
    retry: () => {
      lookups.delete(query);
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}
