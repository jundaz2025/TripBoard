// Converts provider results into saved places without pretending that unknown opening hours are verified.
import { api, ApiError } from "./api";

export type LocationResult = {
  name: string;
  address: string;
  lat: number;
  lon: number;
  website?: string;
  // Nominatim order: south, north, west, east.
  bounds?: [number, number, number, number];
};

export async function searchTripPlaces(tripId: string, query: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<LocationResult[]>(
        `/trips/${encodeURIComponent(tripId)}/places/search?q=` +
          encodeURIComponent(query.trim()),
      );
    } catch (error) {
      // A cold search resolves the city first, then waits for the shared
      // geocoder rate limit before searching inside its bounds.
      if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 2)
        throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 2100));
    }
  }
}

export function placeFromResult(r: LocationResult) {
  return {
    title: r.name.slice(0, 160),
    location: r.address.slice(0, 300),
    lat: r.lat,
    lon: r.lon,
    category: "sight",
    duration: 60,
    opens: "09:00",
    closes: "20:00",
    // Search supplies coordinates, not verified business hours. Defaults must not constrain a route.
    hours_confirmed: false,
    notes: "",
  };
}
