import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, SESSION_KEY } from "./api";
import LoginPage from "./pages/LoginPage";
import RegistrationPage from "./pages/RegistrationPage";
import HardwarePage from "./pages/HardwarePage";
import { Session, User } from "./types";

function readSession(): Session | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return typeof saved?.token === "string" && saved?.user?.id ? saved : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(readSession);
  const [checking, setChecking] = useState(Boolean(session));
  const [checkError, setCheckError] = useState("");
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(window.location.pathname === "/register" ? "register" : "login");

  function signOut(message = "") {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setChecking(false);
    setMessage(message);
    navigate("login");
  }

  function navigate(next: "login" | "register") {
    setPage(next);
    window.history.pushState({}, "", `/${next}`);
  }

  function signIn(next: Session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
    setMessage("");
    setCheckError("");
    setChecking(false);
    window.history.replaceState({}, "", "/");
  }

  useEffect(() => {
    const popstate = () => setPage(window.location.pathname === "/register" ? "register" : "login");
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, []);

  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail === session?.token) {
        signOut("Your session has expired. Please sign in again.");
      }
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [session?.token]);

  useEffect(() => {
    if (!session || !checking) return;
    const controller = new AbortController();
    setCheckError("");
    api<{ user: User }>("/me", { signal: controller.signal }, session.token)
      .then(({ user }) => {
        if (!controller.signal.aborted) signIn({ token: session.token, user });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 401)) {
          setCheckError(errorMessage(error));
        }
      });
    return () => controller.abort();
  }, [session?.token, checking, retry]);

  if (checking) {
    return <main className="loading-shell">
      <h1>Hardware Library</h1>
      {checkError ? <>
        <p role="alert">{checkError}</p>
        <button onClick={() => setRetry((value) => value + 1)}>Try again</button>
        <button className="secondary" onClick={() => signOut()}>Back to sign in</button>
      </> : <p role="status">Checking your session…</p>}
    </main>;
  }
  if (session) return <HardwarePage key={session.token} session={session} onSignOut={() => signOut()} />;
  if (page === "register") return <RegistrationPage onRegister={signIn} onLogin={() => navigate("login")} />;
  return <LoginPage onLogin={signIn} onRegister={() => navigate("register")} message={message} />;
}
