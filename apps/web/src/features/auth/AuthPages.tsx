import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PasswordStrengthMeter } from "../../components/PasswordStrengthMeter";
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
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline OTP verification state when EMAIL_NOT_VERIFIED occurs
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

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
          const resolvedEmail =
            (typeof err.details?.email === "string" && err.details.email) ||
            (identifier.includes("@") ? identifier.trim() : "");
          setPendingEmail(resolvedEmail);
          setOtpMessage(
            resolvedEmail
              ? `An OTP verification code has been dispatched to ${resolvedEmail}.`
              : "Please enter your registered email and OTP code.",
          );
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
      await apiClient.verifyOtp({ email: pendingEmail.trim(), code: otpCode.trim() });
      setPendingEmail(null);
      setOtpMessage("Email verified! Your account is now active — sign in below.");
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
      const res = await apiClient.resendOtp(pendingEmail.trim());
      setCooldownSeconds(30);
      setOtpMessage(
        `A new 6-digit OTP code was sent to ${pendingEmail} (valid for ${res.data.otpTtlSeconds}s). Check your inbox or spam folder.`,
      );
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
        {pendingEmail !== null ? "Verify Account OTP" : "Sign In"}
      </h1>
      <p className="mt-1 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        {pendingEmail !== null
          ? "Check your inbox (and Spam folder) for the 6-digit confirmation code."
          : "Sign in with your username or email to sync progress, ratings, comments, and lists."}
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
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                disabled={cooldownSeconds > 0}
                onClick={handleResend}
                className="cursor-pointer underline disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: "var(--mr-accent)" }}
              >
                {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend OTP"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingEmail(null);
                  setError(null);
                }}
                className="cursor-pointer underline"
                style={{ color: "var(--mr-text-muted)" }}
              >
                Back to Sign In
              </button>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              {submitting ? "Verifying..." : "Verify Account"}
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
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="login-password" className="text-xs font-medium">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-xs font-medium underline"
                style={{ color: "var(--mr-accent)" }}
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border py-2 pr-14 pl-3 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-[11px] font-medium"
                style={{ color: "var(--mr-text-muted)" }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
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

      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{ color: "var(--mr-text-secondary)" }}
      >
        <span>
          New reader?{" "}
          <Link
            to="/register"
            className="font-medium underline"
            style={{ color: "var(--mr-accent)" }}
          >
            Create an account
          </Link>
        </span>
        <Link
          to="/verify-email"
          className="font-medium underline"
          style={{ color: "var(--mr-text-muted)" }}
        >
          Verify OTP
        </Link>
      </div>
    </section>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<"FORM" | "OTP" | "DONE">("FORM");
  const [otpCode, setOtpCode] = useState("");
  const [otpTtl, setOtpTtl] = useState(120);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

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
      setOtpCode("");
      setCooldownSeconds(30);
      setStep("OTP");
      setInfo(
        `Registration created for ${res.data.username}. Enter the 6-digit OTP sent to ${email} via email (expires in ${res.data.otpTtlSeconds}s).`,
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
      setCooldownSeconds(30);
      setInfo(`New OTP dispatched to ${email} via email (valid for ${res.data.otpTtlSeconds}s).`);
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
            Your account is now verified and active! Sign in to start tracking your reading.
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
              disabled={cooldownSeconds > 0}
              onClick={handleResend}
              className="cursor-pointer text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--mr-accent)" }}
            >
              {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend OTP"}
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
            <label className="mb-1 block text-xs font-medium">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border py-2 pr-14 pl-3 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-[11px] font-medium"
                style={{ color: "var(--mr-text-muted)" }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {password ? <PasswordStrengthMeter password={password} /> : null}
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

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"REQUEST" | "VERIFY_OTP" | "NEW_PASSWORD" | "DONE">("REQUEST");
  const [identifier, setIdentifier] = useState("");
  const [resolvedEmail, setResolvedEmail] = useState("");
  const [resolvedUsername, setResolvedUsername] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpTtl, setOtpTtl] = useState(120);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleRequestReset(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.forgotPassword(identifier.trim());
      setResolvedEmail(res.data.email);
      setResolvedUsername(res.data.username);
      setOtpTtl(res.data.otpTtlSeconds);
      setOtpCode("");
      setCooldownSeconds(30);
      setStep("VERIFY_OTP");
      setInfo(
        `A 6-digit password reset OTP was sent to ${res.data.email} (valid for ${res.data.otpTtlSeconds}s). Check your inbox or spam folder.`,
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not request password reset.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendReset() {
    if (!resolvedEmail) return;
    setError(null);
    try {
      const res = await apiClient.forgotPassword(resolvedEmail);
      setOtpTtl(res.data.otpTtlSeconds);
      setCooldownSeconds(30);
      setInfo(`New OTP code dispatched to ${resolvedEmail}. Check your inbox or spam folder.`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not resend reset OTP.");
    }
  }

  async function handleVerifyResetOtp(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.verifyResetOtp({
        email: resolvedEmail,
        code: otpCode.trim(),
      });
      setResolvedUsername(res.data.username);
      setStep("NEW_PASSWORD");
      setInfo(`OTP verified for @${res.data.username}. Enter a strong new password below.`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Invalid or expired OTP code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReset(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.resetPassword({
        email: resolvedEmail,
        code: otpCode.trim(),
        newPassword,
      });
      setStep("DONE");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Password reset failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="mx-auto my-8 max-w-lg rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="mb-4 space-y-1">
        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase"
          style={{ backgroundColor: "var(--mr-bg-elevated)", color: "var(--mr-accent)" }}
        >
          Account Recovery
        </span>
        <h1 className="text-xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
          Forgot Password
        </h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Recover access via a 6-digit OTP verification code sent to your account email.
        </p>
      </div>

      {/* Step progress indicator */}
      <div className="mb-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold">
        {(
          [
            { id: "REQUEST", label: "1. Account" },
            { id: "VERIFY_OTP", label: "2. Email OTP" },
            { id: "NEW_PASSWORD", label: "3. New Password" },
          ] as const
        ).map((item, idx) => {
          const currentIdx =
            step === "REQUEST" ? 0 : step === "VERIFY_OTP" ? 1 : step === "NEW_PASSWORD" ? 2 : 3;
          const active = currentIdx === idx;
          const done = currentIdx > idx;
          return (
            <div
              key={item.id}
              className="rounded border py-1.5"
              style={{
                backgroundColor: active || done ? "var(--mr-bg-elevated)" : "var(--mr-bg-canvas)",
                borderColor: active
                  ? "var(--mr-accent)"
                  : done
                    ? "var(--mr-success)"
                    : "var(--mr-border-subtle)",
                color: active
                  ? "var(--mr-accent)"
                  : done
                    ? "var(--mr-success)"
                    : "var(--mr-text-muted)",
              }}
            >
              {done ? `✓ ${item.label}` : item.label}
            </div>
          );
        })}
      </div>

      {info ? (
        <p
          className="mb-4 rounded border p-2.5 text-xs font-medium"
          style={{ borderColor: "var(--mr-accent)", color: "var(--mr-text-primary)" }}
        >
          {info}
        </p>
      ) : null}

      {step === "REQUEST" ? (
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div>
            <label htmlFor="forgot-identifier" className="mb-1 block text-xs font-medium">
              Email Address or Username
            </label>
            <input
              id="forgot-identifier"
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com or username"
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
            {submitting ? "Sending OTP..." : "Send Reset OTP to Email"}
          </button>
        </form>
      ) : step === "VERIFY_OTP" ? (
        <form onSubmit={handleVerifyResetOtp} className="space-y-4">
          <div>
            <label htmlFor="reset-otp-input" className="mb-1 block text-xs font-medium">
              6-digit Reset OTP ({resolvedEmail} · TTL {otpTtl}s)
            </label>
            <input
              id="reset-otp-input"
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={cooldownSeconds > 0}
              onClick={handleResendReset}
              className="cursor-pointer text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--mr-accent)" }}
            >
              {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend OTP"}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              {submitting ? "Checking OTP..." : "Verify OTP Code"}
            </button>
          </div>
        </form>
      ) : step === "NEW_PASSWORD" ? (
        <form onSubmit={handleConfirmReset} className="space-y-4">
          <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
            Resetting password for <strong>@{resolvedUsername || resolvedEmail}</strong>
          </p>
          <div>
            <label htmlFor="reset-new-password" className="mb-1 block text-xs font-medium">
              New Strong Password
            </label>
            <div className="relative">
              <input
                id="reset-new-password"
                type={showNew ? "text" : "password"}
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-[var(--mr-radius-sm)] border py-2 pr-14 pl-3 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowNew((prev) => !prev)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-[11px] font-medium"
                style={{ color: "var(--mr-text-muted)" }}
              >
                {showNew ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="mb-1 block text-xs font-medium">
              Confirm New Password
            </label>
            <input
              id="reset-confirm-password"
              type={showNew ? "text" : "password"}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <PasswordStrengthMeter password={newPassword} confirmPassword={confirmPassword} />
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
            {submitting ? "Updating Password..." : "Reset Password & Sign In"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium" style={{ color: "var(--mr-success)" }}>
            Password updated successfully for @{resolvedUsername || resolvedEmail}! All prior
            sessions have been revoked for security.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full cursor-pointer rounded-[var(--mr-radius-sm)] py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Continue to Sign In
          </button>
        </div>
      )}

      <p className="mt-5 text-center text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        Remembered your password?{" "}
        <Link to="/login" className="font-medium underline" style={{ color: "var(--mr-accent)" }}>
          Back to Sign In
        </Link>
      </p>
    </section>
  );
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.verifyOtp({ email: email.trim(), code: code.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!email.trim()) {
      setError("Enter your registered email address first.");
      return;
    }
    setError(null);
    try {
      const res = await apiClient.resendOtp(email.trim());
      setCooldownSeconds(30);
      setInfo(`Verification OTP sent to ${email.trim()} (valid for ${res.data.otpTtlSeconds}s).`);
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
        Verify Account Email (OTP)
      </h1>
      <p className="mt-1 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
        Activate a newly registered or pending account using the 6-digit OTP code from your email.
      </p>

      {done ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm font-medium" style={{ color: "var(--mr-success)" }}>
            Email verification completed! Your account is now ACTIVE.
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
      ) : (
        <form onSubmit={handleVerify} className="mt-4 space-y-4">
          {info ? (
            <p className="text-xs font-medium" style={{ color: "var(--mr-accent)" }}>
              {info}
            </p>
          ) : null}
          <div>
            <label htmlFor="verify-email-input" className="mb-1 block text-xs font-medium">
              Registered Email
            </label>
            <input
              id="verify-email-input"
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
            <label htmlFor="verify-otp-code" className="mb-1 block text-xs font-medium">
              6-digit OTP Code
            </label>
            <input
              id="verify-otp-code"
              type="text"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
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
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={cooldownSeconds > 0}
              onClick={handleResend}
              className="cursor-pointer text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--mr-accent)" }}
            >
              {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Send / Resend OTP"}
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
      )}
    </section>
  );
}
