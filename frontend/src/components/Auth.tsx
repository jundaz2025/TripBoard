// Keeps registration/login drafts locally and sends credentials to the cookie-session API.
import { tr, translateMessage } from "../i18n";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Compass,
  ArrowRight,
  Check,
  Circle,
  MapPin,
  Users,
  Route,
} from "lucide-react";
import { api, message } from "../api";
import type { User } from "../types";
import LanguageSwitch from "./LanguageSwitch";
import PasswordField from "./PasswordField";
import { passwordRules } from "../passwordRules";
export default function Auth({ onUser }: { onUser: (u: User) => void }) {
  const [register, setRegister] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = passwordRules.every((r) => r.test(password));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (register && !valid) {
      setError("Please meet all five password requirements.");
      return;
    }
    if (register && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    // Keep credentials in form/component state; authentication uses an HttpOnly cookie, not localStorage.
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      onUser(
        await api("/auth/" + (register ? "register" : "login"), "POST", {
          email: form.get("email"),
          password,
          ...(register
            ? { name: form.get("name"), confirm_password: confirmation }
            : {}),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-language"><LanguageSwitch /></div>
      <section className="auth-story">
        <a className="brand">
          <Compass />{tr("tripboard")}<span>®</span>
        </a>
        <div>
          <p className="eyebrow">{tr("GOOD TRIPS START TOGETHER")}</p>
          <h1>{tr("Less planning.")}<br />{tr("More being there.")}</h1>
          <p>{tr("One place for your favorite finds,")}<br />{tr("your next adventure, and your people.")}</p>
          <div className="journey-card">
            <span className="journey-label">{tr("A WEEKEND WELL SPENT")}</span>
            <div>
              <span className="journey-stop">
                <MapPin size={18} />
              </span>
              <span>
                <strong>{tr("A little exploring")}</strong>
                <small>{tr("Save the places you can't wait to see.")}</small>
              </span>
            </div>
            <div>
              <span className="journey-stop">
                <Route size={18} />
              </span>
              <span>
                <strong>{tr("A plan that flows")}</strong>
                <small>{tr("Make room for the unexpected.")}</small>
              </span>
            </div>
            <div>
              <span className="journey-stop">
                <Users size={18} />
              </span>
              <span>
                <strong>{tr("Better company")}</strong>
                <small>{tr("Bring everyone along, in real time.")}</small>
              </span>
            </div>
          </div>
        </div>
        <small>{tr("Plan a little. Wander a lot.")}</small>
      </section>
      <section className="auth-form">
        <span className="feature-icon">
          <Compass size={30} />
        </span>
        <p className="eyebrow">{tr("YOUR NEXT ADVENTURE")}</p>
        <h2>{register ? tr("Make yourself at home.") : tr("Welcome back.")}</h2>
        <p>
          {register
            ? tr("Great trips start with a shared plan.")
            : tr("Pick up where your plans left off.")}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label>{tr("Your name")}<input
                name="name"
                autoComplete="name"
                required
                maxLength={80}
                placeholder={tr("Alex Morgan")}
              />
            </label>
          )}
          <label>{tr("Email")}<input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder={tr("you@example.com")}
            />
          </label>
          <PasswordField
            key={String(register)}
            value={password}
            onChange={setPassword}
            creating={register}
            describedBy={register ? "password-rules" : undefined}
          />
          {register && (
            <>
              <ul className="password-rules" id="password-rules">
                {passwordRules.map((r) => (
                  <li key={tr(r.label)} className={r.test(password) ? "met" : ""}>
                    {r.test(password) ? (
                      <Check size={13} />
                    ) : (
                      <Circle size={11} />
                    )}
                    {tr(r.label)}
                  </li>
                ))}
              </ul>
              <PasswordField
                label={tr("Confirm password")}
                name="confirm_password"
                value={confirmation}
                onChange={setConfirmation}
                creating
                describedBy="password-match"
              />
              <p
                id="password-match"
                className={
                  confirmation && confirmation !== password
                    ? "match-hint invalid"
                    : "match-hint"
                }
                aria-live="polite"
              >
                {confirmation
                  ? confirmation === password
                    ? tr("Passwords match.")
                    : tr("Passwords do not match yet.")
                  : tr("Enter the same password again.")}
              </p>
            </>
          )}
          {error && (
            <div className="alert error" role="alert">
              {translateMessage(error)}
            </div>
          )}
          <button className="wide" disabled={busy}>
            {busy ? tr("One moment…") : register ? tr("Create account") : tr("Sign in")}
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
            setPassword("");
            setConfirmation("");
          }}
        >
          {register
            ? tr("Already have an account? Sign in")
            : tr("New to TripBoard? Create an account")}
        </button>
      </section>
    </div>
  );
}
