import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient } from "../../services/apiClient";

const DEMO_ACCOUNTS = [
  { label: "Reader 1", identifier: "reader1", password: "Reader@123456" },
  { label: "Reader 2", identifier: "reader2", password: "Reader@123456" },
  { label: "Admin", identifier: "admin", password: "Admin@123456" },
];

export function LoginPage() {
  const { loginWithCredentials } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline OTP verification state when EMAIL_NOT_VERIFIED occurs
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpMessage, setOtpMessage] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await loginWithCredentials(identifier.trim(), password);
      if (user.role === "ADMIN" && nextPath === "/") {
        navigate("/admin");
      } else {
        navigate(nextPath);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "EMAIL_NOT_VERIFIED") {
          setPendingEmail(identifier.includes("@") ? identifier.trim() : "");
          setError("Your account requires email OTP verification before signing in.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Unable to sign in right now.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!pendingEmail) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.verifyOtp({ email: pendingEmail, code: otpCode.trim() });
      setPendingEmail(null);
      setOtpMessage("Email verified! You can now sign in.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Invalid OTP code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail) return;
    setError(null);
    try {
      const res = await apiClient.resendOtp(pendingEmail);
      if (res.data.devOtpPreview) {
        setOtpCode(res.data.devOtpPreview);
        setOtpMessage(
          `A new OTP code was issued: ${res.data.devOtpPreview} (dev preview, valid for ${res.data.otpTtlSeconds}s).`,
        );
      } else {
        setOtpMessage(`A new OTP code was issued (valid for ${res.data.otpTtlSeconds}s).`);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not resend OTP.");
    }
  }

  return (
    <section
      className="mx-auto my-8 max-w-md rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <h1 className="text-xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
        Sign In
      </h1>
      <p className="mt-1 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        Sign in with your username or email to sync progress, ratings, comments, and lists.
      </p>

      {otpMessage ? (
        <p
          className="mt-3 rounded border p-2.5 text-xs font-medium"
          style={{ borderColor: "var(--mr-success)", color: "var(--mr-success)" }}
        >
          {otpMessage}
        </p>
      ) : null}

      {pendingEmail !== null ? (
        <form onSubmit={handleVerifyOtp} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Account Email</label>
            <input
              type="email"
              required
              value={pendingEmail}
              onChange={(e) => setPendingEmail(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">6-digit OTP Code</label>
            <input
              type="text"
              required
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="123456"
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 font-mono text-sm tracking-widest"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          {error ? (
            <p className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleResend}
              className="cursor-pointer text-xs underline"
              style={{ color: "var(--mr-accent)" }}
            >
              Resend OTP
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Verify Account
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleLogin} className="mt-4 space-y-4">
          <div>
            <label htmlFor="login-identifier" className="mb-1 block text-xs font-medium">
              Username or Email
            </label>
            <input
              id="login-identifier"
              type="text"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block text-xs font-medium">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full cursor-pointer rounded-[var(--mr-radius-sm)] py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      )}

      <div
        className="mt-5 rounded-[var(--mr-radius-sm)] border p-3"
        style={{
          backgroundColor: "var(--mr-bg-elevated)",
          borderColor: "var(--mr-border-subtle)",
        }}
      >
        <p
          className="mb-2 text-[11px] font-semibold uppercase"
          style={{ color: "var(--mr-text-muted)" }}
        >
          Local Dev Demo Accounts (Click to autofill)
        </p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.identifier}
              type="button"
              onClick={() => {
                setIdentifier(acc.identifier);
                setPassword(acc.password);
                setPendingEmail(null);
              }}
              className="cursor-pointer rounded border px-2 py-1 text-xs font-medium"
              style={{
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              {acc.label} ({acc.identifier})
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-center text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        New reader?{" "}
        <Link
          to="/register"
          className="font-medium underline"
          style={{ color: "var(--mr-accent)" }}
        >
          Create an account
        </Link>
      </p>
    </section>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<"FORM" | "OTP" | "DONE">("FORM");
  const [otpCode, setOtpCode] = useState("");
  const [otpTtl, setOtpTtl] = useState(120);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.register({
        email: email.trim(),
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setOtpTtl(res.data.otpTtlSeconds);
      setDevOtpPreview(res.data.devOtpPreview ?? null);
      if (res.data.devOtpPreview) {
        setOtpCode(res.data.devOtpPreview);
      }
      setStep("OTP");
      setInfo(
        `Registration created for ${res.data.username}. Enter the 6-digit OTP sent to ${email} (expires in ${res.data.otpTtlSeconds}s).`,
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.verifyOtp({ email: email.trim(), code: otpCode.trim() });
      setStep("DONE");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "OTP verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    try {
      const res = await apiClient.resendOtp(email.trim());
      setOtpTtl(res.data.otpTtlSeconds);
      setDevOtpPreview(res.data.devOtpPreview ?? null);
      if (res.data.devOtpPreview) {
        setOtpCode(res.data.devOtpPreview);
      }
      setInfo(`New OTP issued (valid for ${res.data.otpTtlSeconds}s).`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not resend OTP.");
    }
  }

  return (
    <section
      className="mx-auto my-8 max-w-md rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <h1 className="text-xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
        {step === "OTP" ? "Verify Email OTP" : "Create Reader Account"}
      </h1>

      {step === "DONE" ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm" style={{ color: "var(--mr-success)" }}>
            Your account is now active! Sign in to start tracking your reading progress.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full cursor-pointer rounded-[var(--mr-radius-sm)] py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Go to Sign In
          </button>
        </div>
      ) : step === "OTP" ? (
        <form onSubmit={handleVerify} className="mt-4 space-y-4">
          {info ? (
            <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
              {info}
            </p>
          ) : null}
          {devOtpPreview ? (
            <div
              className="rounded border px-3 py-2 text-xs"
              style={{
                backgroundColor: "rgba(251, 191, 36, 0.12)",
                borderColor: "var(--mr-warning)",
                color: "var(--mr-warning)",
              }}
            >
              Local Dev OTP Preview: <strong className="font-mono">{devOtpPreview}</strong>{" "}
              (auto-filled for quick testing)
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium">6-digit OTP (TTL: {otpTtl}s)</label>
            <input
              type="text"
              required
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="000000"
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 font-mono text-sm tracking-widest"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResend}
              className="cursor-pointer text-xs underline"
              style={{ color: "var(--mr-accent)" }}
            >
              Resend OTP
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              {submitting ? "Verifying..." : "Verify & Activate"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Username (3-50 chars)</label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Display Name (optional)</label>
            <input
              type="text"
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Password (min 8 chars, upper, lower, digit, symbol)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full cursor-pointer rounded-[var(--mr-radius-sm)] py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            {submitting ? "Creating account..." : "Create Account"}
          </button>
        </form>
      )}

      <p className="mt-4 text-center text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        Already have an account?{" "}
        <Link to="/login" className="font-medium underline" style={{ color: "var(--mr-accent)" }}>
          Sign in
        </Link>
      </p>
    </section>
  );
}
