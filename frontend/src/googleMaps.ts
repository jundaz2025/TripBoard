// Optional Google Maps SDK loader; the default map stays MapLibre until a browser key is configured.

/// <reference types="google.maps" />
export const googleMapsKey =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";
// Reuse one loader per page; a browser API key must be restricted to approved website referrers.
let loading: Promise<void> | undefined;
export function loadGoogleMaps(): Promise<void> {
  if (!googleMapsKey)
    return Promise.reject(new Error("Google Maps is not configured."));
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const globals = window as unknown as Record<string, unknown>;
    const timeout = window.setTimeout(
      () => reject(new Error("Google Maps timed out.")),
      15000,
    );
    globals.tripboardGoogleReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    globals.gm_authFailure = () => {
      clearTimeout(timeout);
      window.dispatchEvent(new Event("tripboard-google-error"));
      reject(new Error("Google Maps could not authorize this website."));
    };
    script.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({
        key: googleMapsKey,
        callback: "tripboardGoogleReady",
        loading: "async",
        libraries: "marker",
        // Google fixes its base-map language when this one-time script loads. App labels switch independently.
        language: "en",
        region: "US",
        v: "quarterly",
      });
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Google Maps could not load."));
    };
    document.head.appendChild(script);
  });
  return loading;
}
