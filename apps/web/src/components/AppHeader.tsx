import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { apiClient, type AutocompleteSuggestion } from "../services/apiClient";
import { frontendConfig } from "../services/config";
import { UserAvatar } from "./UserAvatar";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, isAdmin, user, logoutSession } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleGlobalShortcut(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        const target = event.target as HTMLElement | null;
        const isTyping =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          Boolean(target?.isContentEditable);
        if (isTyping && target !== searchInputRef.current) return;
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiClient.autocomplete(trimmed, controller.signal);
        setSuggestions(res.data);
        setDropdownOpen(true);
        setActiveIndex(-1);
      } catch {
        // Ignore aborted or transient autocomplete errors
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const indexedSuggestions = useMemo(() => {
    const mangaItems: Array<{ item: AutocompleteSuggestion; idx: number }> = [];
    const creatorItems: Array<{ item: AutocompleteSuggestion; idx: number }> = [];
    suggestions.forEach((item, idx) => {
      if (item.type === "MANGA") mangaItems.push({ item, idx });
      else creatorItems.push({ item, idx });
    });
    return { mangaItems, creatorItems };
  }, [suggestions]);

  function navigateToSuggestion(item: AutocompleteSuggestion) {
    setDropdownOpen(false);
    setQuery("");
    if (item.type === "MANGA") {
      navigate(`/manga/${item.slug}`);
    } else {
      navigate(`/author/${item.id}/${item.slug}`);
    }
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    setDropdownOpen(false);
    if (trimmed) {
      navigate(`/search/advanced?q=${encodeURIComponent(trimmed)}`);
    } else {
      navigate("/search/advanced");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || suggestions.length === 0) {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      navigateToSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  }

  async function handleLogout() {
    await logoutSession();
    navigate("/");
  }

  const navItems: Array<{ to: string; label: string; admin?: boolean }> = [
    { to: "/explore", label: "Explore" },
    { to: "/search/advanced", label: "Advanced Search" },
  ];
  if (isAuthenticated) {
    navItems.push(
      { to: "/library", label: "Library" },
      { to: "/reading-lists", label: "My Lists" },
      { to: "/history", label: "History" },
      { to: "/settings", label: "Settings" },
    );
  }
  if (isAdmin) {
    navItems.push({ to: "/admin", label: "Admin", admin: true });
  }

  const showDropdown = dropdownOpen && suggestions.length > 0;
  const activeOptionId =
    showDropdown && activeIndex >= 0 ? `header-ac-opt-${activeIndex}` : undefined;

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="mx-auto flex min-h-14 max-w-[var(--mr-max-width)] flex-wrap items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="text-base font-bold tracking-tight"
            style={{ color: "var(--mr-text-primary)" }}
          >
            {frontendConfig.appTitle}
          </Link>
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-4 text-sm md:flex"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  color: item.admin
                    ? "var(--mr-accent)"
                    : isActive
                      ? "var(--mr-accent)"
                      : "var(--mr-text-secondary)",
                  fontWeight: isActive ? 600 : item.admin ? 500 : 400,
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Live Autocomplete Search Box (UC-2.4) */}
        <div ref={containerRef} className="relative min-w-44 flex-1 sm:max-w-xs md:max-w-sm">
          <form onSubmit={handleSearchSubmit} role="search" className="relative">
            <input
              ref={searchInputRef}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              aria-controls="header-search-listbox"
              aria-activedescendant={activeOptionId}
              aria-label="Search manga or creators"
              placeholder="Search manga, alt titles, authors..."
              value={query}
              onFocus={() => {
                if (suggestions.length > 0) setDropdownOpen(true);
              }}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-[var(--mr-radius-sm)] border py-1.5 pr-14 pl-3 text-sm outline-none"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => {
                  setQuery("");
                  setSuggestions([]);
                  setDropdownOpen(false);
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded px-1.5 py-0.5 text-xs"
                style={{ color: "var(--mr-text-muted)" }}
              >
                ✕
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline-block"
                style={{
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-muted)",
                }}
              >
                Ctrl K
              </kbd>
            )}
          </form>

          <span className="sr-only" aria-live="polite">
            {showDropdown ? `${suggestions.length} search suggestions available` : ""}
          </span>

          {showDropdown ? (
            <ul
              id="header-search-listbox"
              role="listbox"
              aria-label="Search suggestions"
              className="absolute right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-[var(--mr-radius-md)] border py-1 shadow-xl"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
              }}
            >
              {indexedSuggestions.mangaItems.length > 0 ? (
                <li
                  role="presentation"
                  className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                  style={{ color: "var(--mr-text-muted)" }}
                >
                  Manga Titles
                </li>
              ) : null}
              {indexedSuggestions.mangaItems.map(({ item, idx }) => (
                <li
                  id={`header-ac-opt-${idx}`}
                  key={`${item.type}-${item.id}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigateToSuggestion(item);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                    style={{
                      backgroundColor:
                        idx === activeIndex ? "var(--mr-bg-elevated)" : "transparent",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        color: "var(--mr-accent)",
                      }}
                    >
                      {item.sublabel || "MANGA"}
                    </span>
                  </button>
                </li>
              ))}

              {indexedSuggestions.creatorItems.length > 0 ? (
                <li
                  role="presentation"
                  className="mt-1 border-t px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                  style={{
                    borderColor: "var(--mr-border-subtle)",
                    color: "var(--mr-text-muted)",
                  }}
                >
                  Authors &amp; Artists
                </li>
              ) : null}
              {indexedSuggestions.creatorItems.map(({ item, idx }) => (
                <li
                  id={`header-ac-opt-${idx}`}
                  key={`${item.type}-${item.id}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigateToSuggestion(item);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                    style={{
                      backgroundColor:
                        idx === activeIndex ? "var(--mr-bg-elevated)" : "transparent",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        color: "var(--mr-success)",
                      }}
                    >
                      CREATOR
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {isAuthenticated && user ? (
            <>
              <Link
                to={`/profile/${user.username}`}
                className="flex items-center gap-1.5 rounded px-2 py-1 font-medium"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-text-primary)",
                }}
              >
                <UserAvatar src={user.avatarUrl} name={user.displayName} size="xs" />
                <span>
                  {user.displayName}
                  {user.role === "ADMIN" ? " · Admin" : ""}
                </span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-2.5 py-1 font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-secondary)",
                }}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-[var(--mr-radius-sm)] px-2.5 py-1 font-medium text-white"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1 font-medium"
                style={{
                  borderColor: "var(--mr-border-strong)",
                  color: "var(--mr-text-primary)",
                }}
              >
                Register
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-2.5 py-1 font-medium"
            style={{
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-primary)",
            }}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center gap-2 overflow-x-auto border-t px-4 py-1.5 text-xs md:hidden"
        style={{ borderColor: "var(--mr-border-subtle)" }}
      >
        {navItems.map((item) => (
          <NavLink
            key={`mobile-${item.to}`}
            to={item.to}
            className="shrink-0 rounded-[var(--mr-radius-sm)] px-2.5 py-1 font-medium"
            style={({ isActive }) => ({
              backgroundColor: isActive ? "var(--mr-bg-elevated)" : "transparent",
              color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
