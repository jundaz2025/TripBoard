// Bridge the shared locale store into React without creating a separate language state per component.
import { useSyncExternalStore } from "react";
import { getLanguage, subscribeLanguage } from "./i18n";

// Subscribe to one stable external store. Language changes rerender components
// in place, preserving their draft fields, selected trip and socket connection.
export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => "en" as const);
}
