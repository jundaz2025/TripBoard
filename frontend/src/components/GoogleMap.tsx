// Renders the same map plan with Google Maps; provider failure hands control back to the fallback map.
import { tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../googleMaps";
import type { MapProps } from "./MapView";
import { createMapPin } from "../mapPins";
import { cameraRequest, CameraController } from "../mapCamera";
export default function GoogleMap({
  plan,
  selected,
  onSelect,
  preview,
  destination,
  trip,
  overview,
  savedOverview,
  focusRevision,
  onError,
}: MapProps & { onError: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const camera = useRef(new CameraController());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    const fail = () => {
      if (active) onError();
    };
    window.addEventListener("tripboard-google-error", fail);
    const canvas = container.current;
    const interact = () => camera.current.interact();
    canvas?.addEventListener("pointerdown", interact);
    canvas?.addEventListener("wheel", interact, { passive: true });
    canvas?.addEventListener("keydown", interact);
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
        map.current.addListener("dragstart", () => camera.current.interact());
        setLoaded(true);
      })
      .catch(fail);
    return () => {
      active = false;
      window.removeEventListener("tripboard-google-error", fail);
      canvas?.removeEventListener("pointerdown", interact);
      canvas?.removeEventListener("wheel", interact);
      canvas?.removeEventListener("keydown", interact);
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [onError]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const { points } = plan;
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
    return () => {
      // Detach overlays on rerender/unmount so stale markers and routes cannot remain visible.
      markers.forEach((marker) => {
        marker.map = null;
      });
      lines.forEach(line => line.setMap(null));
    };
  }, [loaded, plan, selected, onSelect]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const target = camera.current.next(cameraRequest({ plan, tripId: trip.id, city: trip.destination, selected, preview, destination, overview, savedOverview, focusRevision }));
    if (!target) return;
    if (target.kind === "point") {
      m.panTo({ lat: target.lat, lng: target.lon });
      m.setZoom(target.zoom);
    } else if (target.kind === "bounds") {
      const bounds = new google.maps.LatLngBounds();
      target.coordinates.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      // Apply the cap before fitting, avoiding asynchronous idle callbacks that can undo a gesture.
      m.setOptions({ maxZoom: target.maxZoom });
      m.fitBounds(bounds, target.padding);
      m.setOptions({ maxZoom: null });
    }
  }, [plan, loaded, selected, preview, destination, trip.id, trip.destination, overview, savedOverview, focusRevision]);
  return (
    <div className="map-panel">
      <div className="map-canvas" ref={container} />
      {!loaded && <div className="map-empty">{tr("Loading Google Maps…")}</div>}
      <div className="map-legend">{tr("Dashed lines show each day's stop order, not road routes. Days are never joined.")}</div>
    </div>
  );
}
