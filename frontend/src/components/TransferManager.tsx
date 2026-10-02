// A reviewed handoff changes both roles in one server transaction; leaving remains a separate choice.
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, message } from "../api";
import { tr, translateMessage } from "../i18n";
import type { Trip } from "../types";
import Modal from "./Modal";

export default function TransferManager({ trip, onClose, onTransferred }: {
  trip: Trip;
  onClose: () => void;
  onTransferred: (trip: Trip) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [version] = useState(trip.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = trip.members.filter(member => member.role !== "owner");
  const selected = candidates.find(member => member.id === recipient);

  return <Modal title="Transfer manager" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!selected || busy) return;
      setBusy(true);
      setError("");
      try {
        const next = await api<Trip>(`/trips/${trip.id}/transfer-manager`, "POST", { user_id: selected.id }, version);
        onTransferred(next);
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    }}>
      <p>{tr("Every trip has exactly one Manager. Choose a current member to take over.")}</p>
      <label className="manager-recipient">
        {tr("New Manager")}
        <select required value={selected ? recipient : ""} disabled={busy}
          onChange={event => setRecipient(event.target.value)}>
          <option value="">{tr("Choose a member")}</option>
          {candidates.map(member => <option key={member.id} value={member.id}>
            {member.name} · {member.email}
          </option>)}
        </select>
      </label>
      {selected && <div className="alert info" role="status">
        {tr("{name} will become the only Manager. You will become an Editor and can then leave the trip.", { name: selected.name })}
      </div>}
      {error && <div className="alert error" role="alert">{translateMessage(error)}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>{tr("Cancel")}</button>
        <button type="submit" disabled={!selected || busy}>
          <ArrowRight size={16} />{busy ? tr("Transferring…") : tr("Confirm transfer")}
        </button>
      </div>
    </form>
  </Modal>;
}
