// Own one authorized trip session so delayed requests cannot restore revoked or previously selected data.
import { ApiError, message } from "./api";
import type { Change, Trip } from "./types";

export type AccessLoss = "access" | "session" | "left";
type SyncResult = { snapshot: Trip; events: Change[] };
type Callbacks = {
  fetch: (version: number) => Promise<SyncResult>;
  onSnapshot: (trip: Trip) => void;
  onEvents: (events: Change[]) => void;
  onError: (error: string) => void;
  onUnavailable: (reason: AccessLoss) => void;
};

export class TripSyncSession {
  active = true;
  private version = 0;
  private id: string;
  private callbacks: Callbacks;

  constructor(id: string, callbacks: Callbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  accept(next: Trip) {
    if (!this.active || next.id !== this.id || next.version <= this.version) return;
    this.version = next.version;
    this.callbacks.onSnapshot(next);
  }

  stop() {
    this.active = false;
  }

  revoke(reason: AccessLoss = "access") {
    if (!this.active) return;
    // Close the gate before notifying React: concurrent success responses must already be invalid.
    this.stop();
    this.callbacks.onUnavailable(reason);
  }

  async refresh() {
    if (!this.active) return;
    try {
      const result = await this.callbacks.fetch(this.version);
      if (!this.active) return;
      this.accept(result.snapshot);
      this.callbacks.onEvents(result.events);
      this.callbacks.onError("");
    } catch (error) {
      if (!this.active) return;
      // Only authoritative read failures revoke access. Network/5xx errors preserve a recoverable session.
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        this.revoke(error.status === 401 ? "session" : "access");
      } else {
        this.callbacks.onError(message(error));
      }
    }
  }
}
