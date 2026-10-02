// No request is made until the user explicitly confirms this detached place draft.
import Modal from "./Modal";
import { tr, translateMessage } from "../i18n";
export default function SavePlaceConfirm({ name, address, activity, busy, error, onConfirm, onActivityOnly, onCancel }: {
  name: string; address: string; activity?: boolean; busy: boolean; error: string;
  onConfirm: () => void; onActivityOnly?: () => void; onCancel: () => void;
}) {
  return <Modal title={tr("Save this place?")} onClose={() => { if (!busy) onCancel(); }}>
    <p><strong>{name}</strong></p><p>{address}</p>
    <p>{activity ? tr("Save this location to Saved places and link it to your activity?") : tr("Add this location to your trip's Saved places?")}</p>
    {activity && <p className="field-help">{tr("Activity only keeps the address and map pin, without adding to Saved places.")}</p>}
    {error && <p className="alert error" role="alert">{translateMessage(error)}</p>}
    <div className="modal-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>{tr("Cancel")}</button>
      {onActivityOnly && <button type="button" className="secondary" disabled={busy} onClick={onActivityOnly}>{tr("Activity only")}</button>}
      <button type="button" disabled={busy} onClick={onConfirm}>{busy ? tr("Saving…") : activity ? tr("Save place and activity") : tr("Save place")}</button>
    </div>
  </Modal>;
}
