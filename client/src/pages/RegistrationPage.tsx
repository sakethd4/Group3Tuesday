import { FormEvent, useState } from "react";
import { api, errorMessage } from "../api";
import AuthLayout from "../components/AuthLayout";
import { Session } from "../types";

export default function RegistrationPage({ onRegister, onLogin }: {
  onRegister: (session: Session) => void;
  onLogin: () => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const password = String(fields.password);
    if (password !== fields.confirmPassword) {
      setError("Passwords must match.");
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError("Use at least 8 characters with uppercase, lowercase, and a number.");
      return;
    }
    setError("");
    setPending(true);
    try {
      onRegister(await api<Session>("/register", { method: "POST", body: JSON.stringify(fields) }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout title="Create your account">
      <p className="page-copy">Get access to the hardware your organization shares.</p>
      <form className="form-stack" onSubmit={submit}>
        <div className="two-column">
          <label>First name<input name="firstName" autoComplete="given-name" maxLength={80} required /></label>
          <label>Last name<input name="lastName" autoComplete="family-name" maxLength={80} required /></label>
        </div>
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="password-hint" required /></label>
        <p id="password-hint" className="field-hint">Use 8–128 characters with uppercase, lowercase, and a number.</p>
        <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        {error && <p className="message error" role="alert">{error}</p>}
        <button className="primary" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="auth-switch">Already have an account? <button className="text-button" onClick={onLogin}>Sign in</button></p>
    </AuthLayout>
  );
}
