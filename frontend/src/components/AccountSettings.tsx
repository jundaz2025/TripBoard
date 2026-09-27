// Shows a versioned deletion preview before the user confirms an irreversible account removal.
import { tr, translateMessage } from "../i18n";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import Modal from "./Modal";
import PasswordField from "./PasswordField";
import { api, ApiError, message } from "../api";
import type { User } from "../types";
type Preview = {
  owned_trips: { id: string; title: string }[];
  joined_trips: number;
  trip_versions: Record<string, number>;
};
export default function AccountSettings({
  user,
  onClose,
  onDeleted,
}: {
  user: User;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Preview>("/auth/deletion-preview")
      .then(setPreview)
      .catch((e) => setError(message(e)));
  }, []);
  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api("/auth/me", "DELETE", {
        password,
        confirmation,
        // Bind consent to this preview. A concurrent trip change forces a fresh review.
        trip_versions: preview.trip_versions,
      });
      onDeleted();
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.status === 409) {
        setConfirmation("");
        setPreview(null);
        try {
          setPreview(await api<Preview>("/auth/deletion-preview"));
        } catch (err) {
          setError(message(err));
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={tr("Account settings")}
      subtitle={tr("Your profile and account controls.")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="account-profile">
        <span className="avatar">{user.name.slice(0, 1)}</span>
        <div>
          <strong>{user.name}</strong>
          <p>{user.email}</p>
        </div>
        <ShieldCheck size={22} />
      </div>
      <section className="danger-zone">
        <h3>{tr("Delete account")}</h3>
        <p>{tr("Permanently delete your account and sign out on every device.")}</p>
        {!deleting ? (
          <button
            className="danger-outline"
            disabled={!preview}
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={16} />{tr("Delete my account")}</button>
        ) : (
          <form onSubmit={remove}>
            <div className="deletion-summary">
              <strong>{tr("Please review what will be removed.")}</strong>
              {preview ? (
                <>
                  <p>{tr("{count} owned trips will be deleted for everyone, including activities, reservations, invitations, and uploaded files.", {count: preview.owned_trips.length})}</p>
                  {preview.owned_trips.length > 0 && (
                    <ul>
                      {preview.owned_trips.map((t) => (
                        <li key={t.id}>{t.title}</li>
                      ))}
                    </ul>
                  )}
                  <p>{tr("You will leave {count} other trips. Those trips will remain available to their other members.", {count: preview.joined_trips})}</p>
                </>
              ) : (
                <p>{tr("Loading the latest deletion summary…")}</p>
              )}
              <p>{tr("This cannot be undone.")}</p>
            </div>
            <PasswordField
              label={tr("Current password")}
              value={password}
              onChange={setPassword}
            />
            <label>{tr("Type DELETE to confirm")}<input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                required
                pattern="DELETE"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setDeleting(false);
                  setPassword("");
                  setConfirmation("");
                }}
              >{tr("Keep my account")}</button>
              <button
                className="danger-button"
                disabled={
                  busy || !preview || confirmation !== "DELETE" || !password
                }
              >
                {busy ? tr("Deleting…") : tr("Permanently delete account")}
              </button>
            </div>
          </form>
        )}
      </section>
      {error && (
        <div className="alert error" role="alert">
          {translateMessage(error)}
        </div>
      )}
    </Modal>
  );
}
