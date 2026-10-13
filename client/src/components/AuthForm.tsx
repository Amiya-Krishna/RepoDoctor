import { useId, useState, type FormEvent } from "react";
import { api, getErrorMessage } from "../lib/api";

interface AuthFormProps {
  /** Called with the JWT after a successful login or registration. */
  onAuthenticated: (token: string, mode: "login" | "register") => void;
  /** Optional notice shown above the form (e.g. "Your session expired"). */
  notice?: string;
}

type Mode = "login" | "register";
type Field = "name" | "email" | "password";
type FieldErrors = Partial<Record<Field, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the server-side rules in auth.controller.ts; the server remains the
// source of truth and its messages are shown when it rejects a request.
const validate = (mode: Mode, values: Record<Field, string>): FieldErrors => {
  const errors: FieldErrors = {};
  if (mode === "register" && !values.name.trim()) errors.name = "Enter your name.";
  if (!values.email.trim()) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "Enter a valid email address.";
  if (!values.password) errors.password = "Enter your password.";
  else if (mode === "register" && values.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  } else if (values.password.length > 128) errors.password = "Use at most 128 characters.";
  return errors;
};

export default function AuthForm({ onAuthenticated, notice }: AuthFormProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  const setValue = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const switchMode = () => {
    setMode(isRegister ? "login" : "register");
    setErrors({});
    setFormError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return; // guards against double submits (Enter key + click)

    const found = validate(mode, values);
    setErrors(found);
    setFormError("");
    if (Object.values(found).some(Boolean)) return;

    setSubmitting(true);
    try {
      const payload = isRegister
        ? { name: values.name.trim(), email: values.email.trim(), password: values.password }
        : { email: values.email.trim(), password: values.password };
      const response = await api.post(isRegister ? "/auth/register" : "/auth/login", payload);
      // Login returns { data: { token } }; register returns { token }.
      const token = response.data?.data?.token ?? response.data?.token;
      if (typeof token !== "string" || !token) {
        throw new Error("The server response did not contain a session token.");
      }
      onAuthenticated(token, mode);
    } catch (error) {
      setFormError(getErrorMessage(error, "Authentication failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldProps = (field: Field) => ({
    id: `${id}-${field}`,
    value: values[field],
    disabled: submitting,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id}-${field}-error` : undefined,
    onChange: (event: { target: { value: string } }) => setValue(field, event.target.value),
  });

  const fieldError = (field: Field) =>
    errors[field] ? (
      <span className="field-error" id={`${id}-${field}-error`}>
        {errors[field]}
      </span>
    ) : null;

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>RepoDoctor AI</h1>
        <h2>{isRegister ? "Create your account" : "Log in"}</h2>
        {notice && <p className="notice" role="status">{notice}</p>}

        <form onSubmit={(event) => void handleSubmit(event)} noValidate aria-busy={submitting}>
          {isRegister && (
            <div className="field">
              <label htmlFor={`${id}-name`}>Name</label>
              <input type="text" autoComplete="name" {...fieldProps("name")} />
              {fieldError("name")}
            </div>
          )}

          <div className="field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input type="email" autoComplete="email" inputMode="email" {...fieldProps("email")} />
            {fieldError("email")}
          </div>

          <div className="field">
            <label htmlFor={`${id}-password`}>Password</label>
            <div className="password-row">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                {...fieldProps("password")}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {isRegister && !errors.password && <span className="hint">8–128 characters.</span>}
            {fieldError("password")}
          </div>

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <button type="submit" disabled={submitting}>
            {submitting
              ? isRegister ? "Creating account…" : "Logging in…"
              : isRegister ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="switch-mode">
          {isRegister ? "Already have an account?" : "New to RepoDoctor?"}{" "}
          <button type="button" className="link" onClick={switchMode} disabled={submitting}>
            {isRegister ? "Log in" : "Create an account"}
          </button>
        </p>
      </div>
    </main>
  );
}
