// Localizes option labels only; selection values stay valid IANA identifiers.
import { tr } from "../i18n";
import { timeZoneOptionLabel, getTimeZoneOptions } from "../timeZones";

export default function TimeZoneSelect({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  // Providers can return an alias that is absent from the browser's canonical
  // list. Keep that exact ID selected instead of changing its stored value.
  const timeZoneOptions = getTimeZoneOptions();
  const hasValue = timeZoneOptions.some(option => option.value === value);
  return <label>{tr(label)}
    <select value={value} required onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{tr("Choose a city or time zone")}</option>
      {value && !hasValue && <option value={value}>{timeZoneOptionLabel(value)}</option>}
      {timeZoneOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
