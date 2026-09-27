// Creates accessible DOM markers. Labels use textContent rather than interpreting user-entered HTML.
import type { MapPoint } from "./mapPlan";

export function createMapPin(point: MapPoint, selected: string | null, onSelect: (id: string) => void) {
  const el = document.createElement("button");
  const focused = selected === point.id || point.kind === "search";
  el.type = "button";
  el.className = "map-pin day-pin" + (point.active ? " current-day" : point.colors.length ? " other-day" : "") + (focused ? " selected" : "");
  el.style.setProperty("--pin-color", point.color);
  if (point.colors.length > 1) {
    el.classList.add("multi-day");
    el.style.setProperty("--pin-ring", `conic-gradient(${point.colors.map((color, i) => `${color} ${i / point.colors.length * 100}% ${(i + 1) / point.colors.length * 100}%`).join(", ")})`);
  }
  el.textContent = point.text;
  el.title = point.description;
  el.setAttribute("aria-label", point.description);
  el.setAttribute("aria-pressed", String(selected === point.id));
  el.onclick = () => { if (point.kind !== "search") onSelect(point.id); };
  return el;
}
