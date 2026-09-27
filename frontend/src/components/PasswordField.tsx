// Toggles visibility without changing the password value or submitting the surrounding form.
import { tr } from "../i18n";
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
export default function PasswordField({
  label = "Password",
  name = "password",
  value,
  onChange,
  creating = false,
  describedBy,
}: {
  label?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  creating?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="password-field">
      <label htmlFor={id}>{tr(label)}</label>
      <div className="password-input">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={creating ? 12 : 1}
          maxLength={creating ? 128 : 200}
          autoComplete={creating ? "new-password" : "current-password"}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={tr(visible ? "Hide {field}" : "Show {field}", {field: tr(label)})}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
