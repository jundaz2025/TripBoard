// Renders the same map plan with Google Maps; provider failure hands control back to the fallback map.
import { tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../googleMaps";
import type { MapProps } from "./MapView";
import { createMapPin } from "../mapPins";
export default function GoogleMap({
  plan,
  selected,
  onSelect,
  preview,
  destination,
  onError,
}: MapProps & { onError: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    const fail = () => {
      if (active) onError();
    };
    window.addEventListener("tripboard-google-error", fail);
    loadGoogleMaps()
      .then(() => {
        if (!active || !container.current) return;
        map.current = new google.maps.Map(container.current, {
          center: { lat: 20, lng: 0 },
          zoom: 1,
          mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          gestureHandling: "cooperative",
        });
        setLoaded(true);
      })
      .catch(fail);
    return () => {
      active = false;
      window.removeEventListener("tripboard-google-error", fail);
      map.current = null;
    };
  }, [onError]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const { points } = plan;
    const bounds = new google.maps.LatLngBounds();
    points.forEach(point => bounds.extend({ lat: point.lat, lng: point.lon }));
    const markers = points.map((p) => {
      const el = createMapPin(p, selected, onSelect);
      const position = { lat: p.lat, lng: p.lon };
      return new google.maps.marker.AdvancedMarkerElement({
        map: m,
        position,
        content: el,
        title: p.description,
        zIndex: selected === p.id || p.kind === "search" ? 3 : p.active ? 2 : 1,
      });
    });
    // Use a distinct polyline per day, matching the MapLibre rendering contract.
    const lines = plan.routes.map(route => new google.maps.Polyline({
      map: m,
      path: route.coordinates.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: route.color,
      strokeOpacity: 0,
      zIndex: route.active ? 2 : 1,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeColor: route.color, strokeOpacity: route.active ? 0.95 : 0.35, scale: route.active ? 2 : 1.5 },
        offset: "0", repeat: "12px",
      }],
    }));
    const focus = preview || points.find((p) => p.id === selected);
    let destinationListener: google.maps.MapsEventListener | undefined;
    if (focus) {
      m.panTo({ lat: focus.lat, lng: focus.lon });
      m.setZoom(14);
    } else if (points.length === 1) {
      m.setCenter(bounds.getCenter());
      m.setZoom(14);
    } else if (points.length) m.fitBounds(bounds, 70);
    else if (destination) {
      if (destination.bounds) {
        const [south, north, west, east] = destination.bounds;
        m.fitBounds({ south, north, west, east }, 40);
        destinationListener = google.maps.event.addListenerOnce(
          m,
          "idle",
          () => {
            if ((m.getZoom() ?? 0) > 12) m.setZoom(12);
          },
        );
      } else {
        m.setCenter({ lat: destination.lat, lng: destination.lon });
        m.setZoom(11);
      }
    } else {
      m.setCenter({ lat: 20, lng: 0 });
      m.setZoom(1);
    }
    return () => {
      if (destinationListener)
        google.maps.event.removeListener(destinationListener);
      // Detach overlays on rerender/unmount so stale markers and routes cannot remain visible.
      markers.forEach((marker) => {
        marker.map = null;
      });
      lines.forEach(line => line.setMap(null));
    };
  }, [
    loaded,
    plan,
    selected,
    preview,
    destination,
    onSelect,
  ]);
  return (
    <div className="map-panel">
      <div className="map-canvas" ref={container} />
      {!loaded && <div className="map-empty">{tr("Loading Google Maps…")}</div>}
      <div className="map-legend">{tr("Dashed lines show each day's stop order, not road routes. Days are never joined.")}</div>
    </div>
  );
}
