import { useState } from "react";

const SIZE_CLASSES: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-20 w-20 text-xl",
};

export function UserAvatar({
  src,
  name,
  size = "sm",
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && failedSrc !== src);
  const initials = (name || "U").trim().slice(0, 2).toUpperCase();

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-bold ${SIZE_CLASSES[size]} ${className}`}
      style={{
        backgroundColor: "var(--mr-bg-elevated)",
        borderColor: "var(--mr-border-strong)",
        color: "var(--mr-accent)",
      }}
    >
      {showImage ? (
        <img
          src={src!}
          alt={name}
          onError={() => setFailedSrc(src ?? null)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}
