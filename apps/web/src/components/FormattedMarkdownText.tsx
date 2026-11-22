import { Fragment, type ReactNode } from "react";

const INLINE_TOKEN_RE =
  /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s)]+)/g;

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let keyCounter = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      nodes.push(<Fragment key={`t-${keyCounter++}`}>{text.slice(lastIndex, idx)}</Fragment>);
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      nodes.push(
        <strong
          key={`b-${keyCounter++}`}
          className="font-semibold"
          style={{ color: "var(--mr-text-primary)" }}
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      nodes.push(
        <em key={`i-${keyCounter++}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      nodes.push(
        <code
          key={`c-${keyCounter++}`}
          className="rounded px-1 py-0.5 font-mono text-[0.88em]"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            color: "var(--mr-accent)",
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(
          <a
            key={`a-${keyCounter++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline hover:opacity-80"
            style={{ color: "var(--mr-accent)" }}
          >
            {linkMatch[1]} ↗
          </a>,
        );
      } else {
        nodes.push(<Fragment key={`f-${keyCounter++}`}>{token}</Fragment>);
      }
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      const cleanUrl = token.replace(/[.,;!?]+$/, "");
      const trailing = token.slice(cleanUrl.length);
      nodes.push(
        <a
          key={`u-${keyCounter++}`}
          href={cleanUrl}
          target="_blank"
          rel="noreferrer"
          className="break-all underline hover:opacity-80"
          style={{ color: "var(--mr-accent)" }}
        >
          {cleanUrl}
        </a>,
      );
      if (trailing) {
        nodes.push(<Fragment key={`tr-${keyCounter++}`}>{trailing}</Fragment>);
      }
    } else {
      nodes.push(<Fragment key={`r-${keyCounter++}`}>{token}</Fragment>);
    }

    lastIndex = idx + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`end-${keyCounter++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function FormattedMarkdownText({
  content,
  className = "",
  clampLines,
}: {
  content: string;
  className?: string;
  clampLines?: number;
}) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let idx = 0;

  function flushList(keyBase: number) {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    listBuffer = [];
    blocks.push(
      <ul key={`ul-${keyBase}`} className="list-disc space-y-1 pl-5">
        {items.map((item, j) => (
          <li key={j} style={{ color: "var(--mr-text-secondary)" }}>
            {renderInlineMarkdown(item)}
          </li>
        ))}
      </ul>,
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList(i);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushList(i);
      blocks.push(<hr key={`hr-${idx++}`} style={{ borderColor: "var(--mr-border-subtle)" }} />);
      continue;
    }

    const bulletMatch = /^[-*•]\s+(.+)$/.exec(trimmed) || /^\d+\.\s+(.+)$/.exec(trimmed);
    if (bulletMatch?.[1]) {
      listBuffer.push(bulletMatch[1]);
      continue;
    }

    flushList(i);

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[1] && headingMatch[2]) {
      const level = headingMatch[1].length;
      blocks.push(
        <p
          key={`h-${idx++}`}
          className={level === 1 ? "text-base font-bold" : "text-sm font-semibold"}
          style={{ color: "var(--mr-text-primary)" }}
        >
          {renderInlineMarkdown(headingMatch[2])}
        </p>,
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteBody = trimmed.replace(/^>\s*/, "");
      blocks.push(
        <blockquote
          key={`q-${idx++}`}
          className="border-l-2 pl-3 italic"
          style={{
            borderColor: "var(--mr-accent)",
            color: "var(--mr-text-secondary)",
          }}
        >
          {renderInlineMarkdown(quoteBody)}
        </blockquote>,
      );
      continue;
    }

    // Structured "**Native Name:** リキタケ" or "**Native Name**: リキタケ" metadata lines
    const kvMatch =
      /^\*\*([^:*]{1,60}):\*\*\s+(.+)$/.exec(trimmed) ||
      /^\*\*([^*]{1,60})\*\*:\s+(.+)$/.exec(trimmed);
    if (kvMatch?.[1] && kvMatch[2]) {
      blocks.push(
        <div
          key={`kv-${idx++}`}
          className="inline-flex flex-wrap items-baseline gap-1.5 rounded-[var(--mr-radius-sm)] border px-2.5 py-1 text-xs"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <span className="font-semibold" style={{ color: "var(--mr-accent)" }}>
            {kvMatch[1].trim()}:
          </span>
          <span style={{ color: "var(--mr-text-primary)" }}>
            {renderInlineMarkdown(kvMatch[2])}
          </span>
        </div>,
      );
      continue;
    }

    blocks.push(
      <p
        key={`p-${idx++}`}
        className="leading-relaxed"
        style={{ color: "var(--mr-text-secondary)" }}
      >
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  }

  flushList(lines.length);

  return (
    <div
      className={`min-w-0 space-y-2 break-words [overflow-wrap:anywhere] text-sm ${className}`}
      style={
        clampLines
          ? {
              display: "-webkit-box",
              WebkitLineClamp: clampLines,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
          : undefined
      }
    >
      {blocks}
    </div>
  );
}
