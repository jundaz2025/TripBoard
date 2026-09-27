// Shared client representations of server snapshots and proposals; IDs and enum values are never localized.
export type City = { id: number; name: string; address: string; lat: number; lon: number; timezone: string; country_code: string };
export type Role = "owner" | "editor" | "viewer";
export type User = { id: string; name: string; email: string };
// Sidebar summaries carry a version; the full Trip below adds collections and server-derived metadata.
export type TripInfo = {
  id: string;
  version: number;
  role: Role;
  title: string;
  destination: string;
  destination_id?: number | null;
  destination_location?: City | null;
  start_date: string;
  end_date: string;
  timezone: string;
};
export type Place = {
  id: string;
  title: string;
  location: string;
  lat: number;
  lon: number;
  category: string;
  hours_confirmed?: boolean;
  duration: number;
  opens: string;
  closes: string;
  notes: string;
};
export type Activity = {
  id: string;
  title: string;
  location: string;
  notes: string;
  day: string;
  start: string;
  duration: number;
  locked: boolean;
  place_id: string | null;
  reminder_minutes: number | null;
};
export type Hotel = {
  id: string;
  name: string;
  address: string;
  check_in: string;
  check_out: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  hotel_website?: string;
  policy_source_url?: string;
  policy_checked_at?: string;
  lat: number;
  lon: number;
  link: string;
  notes: string;
};
export type Trip = TripInfo & {
  activities: Activity[];
  places: Place[];
  hotels: Hotel[];
  transports?: Transport[];
  members: (User & { role: Role })[];
  documents: { id: string; hotel_id: string; name: string }[];
  conflicts: Conflict[];
};
export type Operation = Partial<Omit<Activity, "id">> & {
  kind: "add" | "update" | "delete";
  id?: string;
};
// Acceptance is bound to base_version so an old suggestion cannot overwrite a newer shared plan.
export type Proposal = {
  id: string;
  kind: string;
  base_version: number;
  explanation: string;
  operations: Operation[];
  metrics: {
    source: string;
    model?: string;
    before_minutes?: number;
    after_minutes?: number;
    order?: { id: string; title: string; start: string }[];
    hotel?: string;
  };
};
export type Config = {
  ai_enabled: boolean;
  ai_model: string;
  live_routes: boolean;
  redis: boolean;
};
export type Notice = {
  id: string;
  trip_id: string;
  message: string;
  read: boolean;
  created_at: string;
};
export type Change = {
  version: number;
  actor: string;
  kind: string;
  created_at: string;
};

// Local endpoint clocks/zones are editable; *_at and duration_minutes are derived by the server.
export type Transport = {
  id: string; title: string; direction: "outbound" | "return";
  mode: "flight" | "driving" | "train" | "bus" | "ferry" | "other";
  origin: string; destination: string;
  departure_city_id?: number | null; arrival_city_id?: number | null;
  departure_point: string; arrival_point: string;
  departure_date: string; departure_time: string; departure_timezone: string;
  arrival_date: string; arrival_time: string; arrival_timezone: string;
  carrier: string; number: string; reference: string; link: string; notes: string;
  departure_at: string; arrival_at: string; duration_minutes: number;
};
// Structured instants drive localized overlap labels; optional days limits warnings to affected itinerary tabs.
export type Conflict = {
  message: string; days?: string[]; kind?: string; timezone?: string;
  overlap_start?: string; overlap_end?: string;
  items?: {id: string; kind: string; title: string; start: string; end: string}[];
};
