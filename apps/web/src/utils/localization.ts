export interface LocaleBadgeInfo {
  code: string;
  label: string;
  flag: string;
  bg: string;
  border: string;
  color: string;
}

const LOCALE_DEFINITIONS: Record<string, Omit<LocaleBadgeInfo, "code">> = {
  ja: {
    label: "Japanese",
    flag: "🇯🇵",
    bg: "rgba(244, 63, 94, 0.14)",
    border: "rgba(244, 63, 94, 0.45)",
    color: "#fb7185",
  },
  "ja-ro": {
    label: "Romaji",
    flag: "🇯🇵",
    bg: "rgba(244, 63, 94, 0.10)",
    border: "rgba(244, 63, 94, 0.35)",
    color: "#fda4af",
  },
  en: {
    label: "English",
    flag: "🇬🇧",
    bg: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.45)",
    color: "#38bdf8",
  },
  vi: {
    label: "Tiếng Việt",
    flag: "🇻🇳",
    bg: "rgba(239, 68, 68, 0.16)",
    border: "rgba(250, 204, 21, 0.55)",
    color: "#facc15",
  },
  ko: {
    label: "Korean",
    flag: "🇰🇷",
    bg: "rgba(99, 102, 241, 0.14)",
    border: "rgba(99, 102, 241, 0.45)",
    color: "#818cf8",
  },
  "ko-ro": {
    label: "Korean (Romanized)",
    flag: "🇰🇷",
    bg: "rgba(99, 102, 241, 0.10)",
    border: "rgba(99, 102, 241, 0.35)",
    color: "#a5b4fc",
  },
  zh: {
    label: "Chinese",
    flag: "🇨🇳",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#f87171",
  },
  "zh-hk": {
    label: "Traditional Chinese",
    flag: "🇭🇰",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#fca5a5",
  },
  "zh-ro": {
    label: "Pinyin",
    flag: "🇨🇳",
    bg: "rgba(239, 68, 68, 0.10)",
    border: "rgba(239, 68, 68, 0.35)",
    color: "#fca5a5",
  },
  fr: {
    label: "French",
    flag: "🇫🇷",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#60a5fa",
  },
  es: {
    label: "Spanish",
    flag: "🇪🇸",
    bg: "rgba(245, 158, 11, 0.14)",
    border: "rgba(245, 158, 11, 0.45)",
    color: "#fbbf24",
  },
  "es-la": {
    label: "Spanish (LATAM)",
    flag: "🇲🇽",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  pt: {
    label: "Portuguese",
    flag: "🇵🇹",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  "pt-br": {
    label: "Portuguese (BR)",
    flag: "🇧🇷",
    bg: "rgba(34, 197, 94, 0.15)",
    border: "rgba(34, 197, 94, 0.45)",
    color: "#4ade80",
  },
  it: {
    label: "Italian",
    flag: "🇮🇹",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  de: {
    label: "German",
    flag: "🇩🇪",
    bg: "rgba(251, 191, 36, 0.14)",
    border: "rgba(251, 191, 36, 0.45)",
    color: "#fbbf24",
  },
  pl: {
    label: "Polish",
    flag: "🇵🇱",
    bg: "rgba(244, 63, 94, 0.14)",
    border: "rgba(244, 63, 94, 0.45)",
    color: "#fb7185",
  },
  tr: {
    label: "Turkish",
    flag: "🇹🇷",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#f87171",
  },
  ru: {
    label: "Russian",
    flag: "🇷🇺",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#93c5fd",
  },
  uk: {
    label: "Ukrainian",
    flag: "🇺🇦",
    bg: "rgba(250, 204, 21, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#fde047",
  },
  ar: {
    label: "Arabic",
    flag: "🇸🇦",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  hi: {
    label: "Hindi",
    flag: "🇮🇳",
    bg: "rgba(249, 115, 22, 0.14)",
    border: "rgba(249, 115, 22, 0.45)",
    color: "#fb923c",
  },
  fi: {
    label: "Finnish",
    flag: "🇫🇮",
    bg: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.45)",
    color: "#7dd3fc",
  },
  id: {
    label: "Indonesian",
    flag: "🇮🇩",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#fca5a5",
  },
  ms: {
    label: "Malay",
    flag: "🇲🇾",
    bg: "rgba(245, 158, 11, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#fbbf24",
  },
  tl: {
    label: "Filipino",
    flag: "🇵🇭",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#60a5fa",
  },
  th: {
    label: "Thai",
    flag: "🇹🇭",
    bg: "rgba(168, 85, 247, 0.14)",
    border: "rgba(168, 85, 247, 0.45)",
    color: "#c084fc",
  },
  sr: {
    label: "Serbian",
    flag: "🇷🇸",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#93c5fd",
  },
  hr: {
    label: "Croatian",
    flag: "🇭🇷",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#fca5a5",
  },
  kk: {
    label: "Kazakh",
    flag: "🇰🇿",
    bg: "rgba(6, 182, 212, 0.14)",
    border: "rgba(250, 204, 21, 0.45)",
    color: "#22d3ee",
  },
  fa: {
    label: "Persian",
    flag: "🇮🇷",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  ro: {
    label: "Romanian",
    flag: "🇷🇴",
    bg: "rgba(250, 204, 21, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#fde047",
  },
  hu: {
    label: "Hungarian",
    flag: "🇭🇺",
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(16, 185, 129, 0.45)",
    color: "#34d399",
  },
  cs: {
    label: "Czech",
    flag: "🇨🇿",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#60a5fa",
  },
  el: {
    label: "Greek",
    flag: "🇬🇷",
    bg: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.45)",
    color: "#7dd3fc",
  },
  he: {
    label: "Hebrew",
    flag: "🇮🇱",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    color: "#93c5fd",
  },
  bg: {
    label: "Bulgarian",
    flag: "🇧🇬",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#34d399",
  },
  mn: {
    label: "Mongolian",
    flag: "🇲🇳",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    color: "#93c5fd",
  },
};

function inferLocaleFromText(text: string): string | null {
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[ăâđêôơưàáảãạ]/i.test(text)) return "vi";
  return null;
}

export function resolveLocaleBadge(
  languageCode: string | null | undefined,
  sampleText?: string,
): LocaleBadgeInfo {
  const norm = (languageCode || "").trim().toLowerCase();
  const inferred = norm || (sampleText ? inferLocaleFromText(sampleText) : null) || "";
  const cfg = LOCALE_DEFINITIONS[inferred];
  if (cfg) {
    return { code: inferred.toUpperCase(), ...cfg };
  }
  if (inferred) {
    return {
      code: inferred.toUpperCase(),
      label: inferred.toUpperCase(),
      flag: "🌐",
      bg: "rgba(148, 163, 184, 0.14)",
      border: "rgba(148, 163, 184, 0.35)",
      color: "var(--mr-text-secondary)",
    };
  }
  return {
    code: "INT",
    label: "International",
    flag: "🌐",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.3)",
    color: "var(--mr-text-secondary)",
  };
}

export function getLocalePriority(normLocale: string, originalLanguage?: string | null): number {
  const norm = normLocale.trim().toLowerCase();
  const orig = (originalLanguage || "").trim().toLowerCase();
  if (!norm) return 99;
  if (orig && norm === orig) return 0;
  switch (norm) {
    case "ja":
      return 1;
    case "ko":
      return 2;
    case "zh":
      return 3;
    case "zh-hk":
      return 4;
    case "en":
      return 5;
    case "vi":
      return 6;
    default:
      return 10;
  }
}

const VOLUME_PATTERN = /^\s*v?(?:ol\.?\s*)?(\d+(?:\.\d+)?)(.*)$/i;

export function compareVolumeKeys(
  volA: string | null | undefined,
  volB: string | null | undefined,
  ascending = true,
): number {
  const va = (volA || "").trim();
  const vb = (volB || "").trim();
  const ma = va ? VOLUME_PATTERN.exec(va) : null;
  const mb = vb ? VOLUME_PATTERN.exec(vb) : null;
  const groupA = ma ? 0 : va ? 1 : 2;
  const groupB = mb ? 0 : vb ? 1 : 2;
  if (groupA !== groupB) {
    return groupA - groupB;
  }
  if (groupA === 0 && ma && mb) {
    const da = Number(ma[1]);
    const db = Number(mb[1]);
    if (da !== db) {
      return ascending ? da - db : db - da;
    }
    return (ma[2] || "").localeCompare(mb[2] || "");
  }
  if (groupA === 1) {
    return ascending ? va.localeCompare(vb) : vb.localeCompare(va);
  }
  return 0;
}
