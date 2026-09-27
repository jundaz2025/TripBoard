// Own the browser language preference and translate application messages without rewriting user content.
import { zh } from "./translations";

export type Language = "en" | "zh";
const STORAGE_KEY = "tripboard.language";
const listeners = new Set<() => void>();

// English is the initial language, even on a Chinese OS. Storage is optional in
// private browsing; an unavailable preference store must never block the app.
function readPreference(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}
let language: Language = readPreference();
export const getLanguage = () => language;
export const getLocale = () => language === "zh" ? "zh-CN" : "en-US";
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = language === "zh" ? "TripBoard · 一起规划旅行" : "TripBoard · Plan together";
}
export function setLanguage(next: Language) {
  if (language === next) return;
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* In-memory selection still works. */ }
  updateDocument();
  listeners.forEach(listener => listener());
}
if (typeof window !== "undefined") {
  // Keep multiple tabs in the same browser consistent without remounting forms.
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY || event.key === null) setLanguage(readPreference());
  });
}
updateDocument();

// Only application-owned messages pass through this function. User-entered
// names, notes and provider addresses are rendered directly, never translated.
export function tr(source: string, values: Record<string, unknown> = {}): string {
  const template = language === "zh" ? (zh[source] ?? source) : source;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : match,
  );
}

// Stored errors and server notices remain canonical English. Match only known
// message templates at render time so changing language also updates old alerts.
const patterns = Object.keys(zh).filter(key => /\{\w+\}/.test(key))
  // Prefer specific sentences over broad action labels such as "Delete {name}".
  .sort((a, b) => b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
  .map(key => {
  const names: string[] = [];
  const escaped = key.split(/(\{\w+\})/g).map(part => {
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return "(.+?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { key, names, pattern: new RegExp("^" + escaped + "$", "s") };
});
export function translateMessage(source: string): string {
  if (language === "en" || zh[source]) return tr(source);
  for (const { key, names, pattern } of patterns) {
    // Generic formatting templates must not capture arbitrary sentences.
    if (!/[a-zA-Z]{3}/.test(key.replace(/\{\w+\}/g, ""))) continue;
    const match = pattern.exec(source);
    if (match) return tr(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return source;
}
