// Displays published-time provenance and retry controls without inventing missing hotel policy times.
import { getLocale, tr, translateMessage } from "../i18n";
import { Search, LoaderCircle, ExternalLink } from "lucide-react";

export type HotelPolicy = {
  check_in_time: string | null;
  check_out_time: string | null;
  source_url: string;
  checked_at: string;
  hotel_website?: string;
};

export default function HotelPolicyLookup({
  canSearch,
  busy,
  error,
  source,
  checkedAt,
  onRetry,
}: {
  canSearch: boolean;
  busy: boolean;
  error: string;
  source: string;
  checkedAt: string;
  onRetry: () => void;
}) {
  return (
    <div className="hotel-policy full">
      <strong>{tr("Hotel check-in & check-out")}</strong>
      {busy ? (
        <p className="hotel-lookup-status" role="status">
          <LoaderCircle size={16} className="spin" />{tr(" Finding the hotel's website and published times…")}</p>
      ) : source ? (
        <div className="policy-suggestion" role="status">
          <p>{tr("Available published times filled in automatically. You can adjust them to match your booking.")}</p>
          <a href={source} target="_blank" rel="noreferrer">{tr("Hotel source ")}<ExternalLink size={13} />
          </a>
          {checkedAt && (
            <small>{tr("Retrieved ")}{new Date(checkedAt).toLocaleString(getLocale())}.
            </small>
          )}
        </div>
      ) : (
        <p className="field-help">
          {canSearch
            ? tr("Find this hotel's published times automatically, or enter them from your booking confirmation.")
            : tr("Select your hotel in the search above. We'll look up its website and fill in the published times.")}
        </p>
      )}
      {error && (
        <p className="alert warning" role="alert">
          {translateMessage(error)}
        </p>
      )}
      {canSearch && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onRetry}
        >
          <Search size={16} />{" "}
          {source ? tr("Refresh hotel times") : tr("Find hotel times automatically")}
        </button>
      )}
    </div>
  );
}
