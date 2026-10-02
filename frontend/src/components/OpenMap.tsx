// Renders the shared map plan with MapLibre and manages imperative map objects outside React state.
import { tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { MapProps } from "./MapView";
import { mapRouteData } from "../mapPlan";
import { createMapPin } from "../mapPins";
import { cameraRequest, CameraController } from "../mapCamera";
export default function OpenMap({
  plan,
  selected,
  onSelect,
  preview,
  destination,
  trip,
  overview,
  savedOverview,
  focusRevision,
}: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const camera = useRef(new CameraController());
  const markers = useRef<maplibregl.Marker[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        center: [0, 20],
        zoom: 1,
        attributionControl: { compact: true },
        style: "https://tiles.openfreemap.org/styles/positron",
      });
      map.current = m;
      // Programmatic camera animations have no original input event.
      m.on("movestart", event => { if (event.originalEvent) camera.current.interact(); });
      m.on("zoomstart", event => { if (event.originalEvent) camera.current.interact(); });
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      m.on("style.load", () => {
        for (const layer of m.getStyle().layers) {
          if (
            layer.type === "symbol" &&
            layer.layout?.["text-field"] &&
            !layer.id.includes("shield")
          ) {
            m.setLayoutProperty(layer.id, "text-field", [
              "coalesce",
              ["get", "name:en"],
              ["get", "name_en"],
              ["get", "name:latin"],
              "",
            ]);
          }
        }
      });
      m.on("load", () => setLoaded(true));
      m.on("error", () => setError(true));
    } catch {
      setError(true);
      return;
    }
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    // Replace imperative markers when the plan changes; never accumulate pins across renders.
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    const { points } = plan;
    for (const p of points) {
      const el = createMapPin(p, selected, onSelect);
      const label = document.createElement("div");
      label.textContent = p.description;
      markers.current.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([p.lon, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 20 }).setDOMContent(label))
          .addTo(m),
      );
    }
    // Every feature is a separate day, preventing lines between consecutive days.
    const data = mapRouteData(plan);
    if (m.getSource("order"))
      (m.getSource("order") as maplibregl.GeoJSONSource).setData(data);
    else {
      m.addSource("order", { type: "geojson", data });
      m.addLayer({
        id: "order",
        type: "line",
        source: "order",
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": ["get", "opacity"],
          "line-width": ["get", "width"],
          "line-dasharray": [2, 2],
        },
      });
    }
    m.setPaintProperty("order", "line-color", ["get", "color"]);
    m.setPaintProperty("order", "line-opacity", ["get", "opacity"]);
    m.setPaintProperty("order", "line-width", ["get", "width"]);
  }, [plan, loaded, selected, onSelect]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const target = camera.current.next(cameraRequest({ plan, tripId: trip.id, city: trip.destination, selected, preview, destination, overview, savedOverview, focusRevision }));
    if (!target) return;
    if (target.kind === "point") m.easeTo({ center: [target.lon, target.lat], zoom: target.zoom, duration: 500 });
    else if (target.kind === "bounds") {
      const bounds = new maplibregl.LngLatBounds();
      target.coordinates.forEach(coordinate => bounds.extend(coordinate));
      m.fitBounds(bounds, { padding: target.padding, maxZoom: target.maxZoom, duration: 500 });
    }
  }, [plan, loaded, selected, preview, destination, trip.id, trip.destination, overview, savedOverview, focusRevision]);
  return (
    <div className="map-panel">
      <div ref={container} className="map-canvas" />
      <div className="map-legend">{tr("Dashed lines show each day's stop order, not road routes. Days are never joined.")}</div>
      {!preview && !plan.points.length && (
        <div className="map-empty">{tr("Search an address above to drop your first red pin.")}</div>
      )}
      {error && (
        <div className="map-error">{tr("Map tiles are unavailable. Your itinerary is still accessible.")}</div>
      )}
    </div>
  );
}
