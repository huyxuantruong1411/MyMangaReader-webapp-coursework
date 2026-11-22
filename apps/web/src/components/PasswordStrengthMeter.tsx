export interface PasswordStrengthResult {
  score: number;
  label: "Too Short" | "Weak" | "Fair" | "Good" | "Strong";
  color: string;
  rules: Array<{ key: string; label: string; met: boolean }>;
}

function evaluatePasswordStrength(
  password: string,
  options?: { confirmPassword?: string; currentPassword?: string },
): PasswordStrengthResult {
  const minLen = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const rules: Array<{ key: string; label: string; met: boolean }> = [
    { key: "len", label: "At least 8 characters", met: minLen },
    { key: "upper", label: "Uppercase letter (A–Z)", met: hasUpper },
    { key: "lower", label: "Lowercase letter (a–z)", met: hasLower },
    { key: "digit", label: "Number (0–9)", met: hasDigit },
    { key: "symbol", label: "Special symbol (!@#$...)", met: hasSymbol },
  ];

  if (options?.confirmPassword !== undefined) {
    rules.push({
      key: "match",
      label: "Confirmation matches new password",
      met: password.length > 0 && options.confirmPassword === password,
    });
  }
  if (options?.currentPassword !== undefined && options.currentPassword.length > 0) {
    rules.push({
      key: "diff",
      label: "Different from current password",
      met: password.length > 0 && password !== options.currentPassword,
    });
  }

  const coreCount = [minLen, hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  let score = 0;
  if (password.length > 0) {
    if (!minLen) {
      score = 1;
    } else if (coreCount <= 2) {
      score = 1;
    } else if (coreCount === 3) {
      score = 2;
    } else if (coreCount === 4) {
      score = 3;
    } else {
      score = 4;
    }
  }

  const labelMap: Record<number, { label: PasswordStrengthResult["label"]; color: string }> = {
    0: { label: "Too Short", color: "var(--mr-text-muted)" },
    1: { label: "Weak", color: "var(--mr-danger)" },
    2: { label: "Fair", color: "var(--mr-warning)" },
    3: { label: "Good", color: "#38bdf8" },
    4: { label: "Strong", color: "var(--mr-success)" },
  };
  const info = labelMap[score] ?? { label: "Weak", color: "var(--mr-danger)" };
  return { score, label: info.label, color: info.color, rules };
}

export function PasswordStrengthMeter({
  password,
  confirmPassword,
  currentPassword,
}: {
  password: string;
  confirmPassword?: string;
  currentPassword?: string;
}) {
  const result = evaluatePasswordStrength(password, { confirmPassword, currentPassword });

  return (
    <div
      className="space-y-2.5 rounded-[var(--mr-radius-sm)] border p-3 text-xs"
      style={{
        backgroundColor: "var(--mr-bg-canvas)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium" style={{ color: "var(--mr-text-secondary)" }}>
          Password Strength
        </span>
        <span className="font-semibold" style={{ color: result.color }}>
          {password ? result.label : "Enter password"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className="h-1.5 rounded-full transition-colors"
            style={{
              backgroundColor:
                password.length > 0 && result.score >= bar ? result.color : "var(--mr-bg-elevated)",
            }}
          />
        ))}
      </div>

      <ul className="grid gap-1 sm:grid-cols-2">
        {result.rules.map((r) => (
          <li
            key={r.key}
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: r.met ? "var(--mr-success)" : "var(--mr-text-muted)" }}
          >
            <span aria-hidden="true">{r.met ? "✓" : "○"}</span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
