import { FormEvent, useState } from "react";
import { api, errorMessage } from "../api";
import AuthLayout from "../components/AuthLayout";
import { Session } from "../types";

export default function LoginPage({ onLogin, onRegister, message }: {
  onLogin: (session: Session) => void;
  onRegister: () => void;
  message: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      onLogin(await api<Session>("/login", {
        method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout title="Welcome back">
      <p className="page-copy">Sign in to access your shared hardware.</p>
      {message && <p className="message" role="status">{message}</p>}
      <form className="form-stack" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
        {error && <p className="message error" role="alert">{error}</p>}
        <button className="primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="auth-switch">New to the library? <button className="text-button" onClick={onRegister}>Create an account</button></p>
    </AuthLayout>
  );
}
