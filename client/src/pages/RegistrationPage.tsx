import { FormEvent, useMemo, useState } from "react";

type Role = "Doctor" | "Nurse" | "Inventory Manager";

type RegistrationForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: Role | "";
};

const initialForm: RegistrationForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  role: "",
};

const roles: Role[] = ["Doctor", "Nurse", "Inventory Manager"];
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

function validateForm(form: RegistrationForm) {
  const errors: Partial<Record<keyof RegistrationForm, string>> = {};

  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  if (!form.lastName.trim()) errors.lastName = "Last name is required.";
  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!form.role) errors.role = "Select a hospital role.";

  if (!form.password) {
    errors.password = "Password is required.";
  } else if (form.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  } else if (!/[A-Z]/.test(form.password)) {
    errors.password = "Include at least one uppercase letter.";
  } else if (!/[a-z]/.test(form.password)) {
    errors.password = "Include at least one lowercase letter.";
  } else if (!/\d/.test(form.password)) {
    errors.password = "Include at least one number.";
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (form.password !== form.confirmPassword) {
    errors.confirmPassword = "Passwords must match.";
  }

  return errors;
}

export default function RegistrationPage() {
  const [form, setForm] = useState<RegistrationForm>(initialForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  const errors = useMemo(() => validateForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  function updateField<K extends keyof RegistrationForm>(field: K, value: RegistrationForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setServerMessage("");
    setIsSuccess(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    setServerMessage("");

    if (hasErrors) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setServerMessage(data.message || "Registration failed.");
        setIsSuccess(false);
        return;
      }

      setForm(initialForm);
      setSubmitAttempted(false);
      setServerMessage(data.message || "Account created successfully.");
      setIsSuccess(true);
    } catch {
      setServerMessage("Could not reach the registration service.");
      setIsSuccess(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function fieldError(field: keyof RegistrationForm) {
    return submitAttempted ? errors[field] : "";
  }

  return (
    <main className="registration-shell">
      <section className="registration-panel" aria-labelledby="registration-title">
        <div className="registration-heading">
          <p className="eyebrow">Hospital Resource Portal</p>
          <h1 id="registration-title">Create staff account</h1>
          <p>
            Register authorized care and inventory staff so they can access equipment
            availability workflows.
          </p>
        </div>

        <form className="registration-form" onSubmit={handleSubmit} noValidate>
          <div className="form-grid two-column">
            <label>
              <span>First name</span>
              <input
                value={form.firstName}
                onChange={(event) => updateField("firstName", event.target.value)}
                autoComplete="given-name"
                aria-invalid={Boolean(fieldError("firstName"))}
              />
              {fieldError("firstName") && <small>{fieldError("firstName")}</small>}
            </label>

            <label>
              <span>Last name</span>
              <input
                value={form.lastName}
                onChange={(event) => updateField("lastName", event.target.value)}
                autoComplete="family-name"
                aria-invalid={Boolean(fieldError("lastName"))}
              />
              {fieldError("lastName") && <small>{fieldError("lastName")}</small>}
            </label>
          </div>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              autoComplete="email"
              aria-invalid={Boolean(fieldError("email"))}
            />
            {fieldError("email") && <small>{fieldError("email")}</small>}
          </label>

          <label>
            <span>Hospital role</span>
            <select
              value={form.role}
              onChange={(event) => updateField("role", event.target.value as RegistrationForm["role"])}
              aria-invalid={Boolean(fieldError("role"))}
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {fieldError("role") && <small>{fieldError("role")}</small>}
          </label>

          <div className="form-grid two-column">
            <label>
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateField("password", event.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldError("password"))}
              />
              {fieldError("password") && <small>{fieldError("password")}</small>}
            </label>

            <label>
              <span>Confirm password</span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(event) => updateField("confirmPassword", event.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldError("confirmPassword"))}
              />
              {fieldError("confirmPassword") && <small>{fieldError("confirmPassword")}</small>}
            </label>
          </div>

          <p className="password-hint">
            Passwords must be at least 8 characters and include uppercase, lowercase, and a number.
          </p>

          {serverMessage && (
            <div className={isSuccess ? "message success" : "message error"} role="status">
              {serverMessage}
              {isSuccess && (
                <a href="/login" className="login-link">
                  Continue to login
                </a>
              )}
            </div>
          )}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
