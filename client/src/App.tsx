import RegistrationPage from "./pages/RegistrationPage";

export default function App() {
  if (window.location.pathname === "/login") {
    return (
      <main className="registration-shell">
        <section className="registration-panel compact-panel">
          <p className="eyebrow">Hospital Resource Portal</p>
          <h1>Login</h1>
          <p className="page-copy">Staff login will be connected as part of SCRUM-10.</p>
          <a className="login-link standalone-link" href="/">
            Back to registration
          </a>
        </section>
      </main>
    );
  }

  return <RegistrationPage />;
}
