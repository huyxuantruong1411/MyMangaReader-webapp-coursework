import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { apiClient, type AutocompleteSuggestion } from "../services/apiClient";
import { frontendConfig } from "../services/config";

export function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, isAdmin, user, logoutSession } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

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
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    } else {
      navigate("/search");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || suggestions.length === 0) return;
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
            <NavLink
              to="/explore"
              style={({ isActive }) => ({
                color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                fontWeight: isActive ? 600 : 400,
              })}
            >
              Explore
            </NavLink>
            <NavLink
              to="/search"
              style={({ isActive }) => ({
                color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                fontWeight: isActive ? 600 : 400,
              })}
            >
              Search
            </NavLink>
            {isAuthenticated ? (
              <>
                <NavLink
                  to="/history"
                  style={({ isActive }) => ({
                    color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  })}
                >
                  History
                </NavLink>
                <NavLink
                  to="/reading-lists"
                  style={({ isActive }) => ({
                    color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  })}
                >
                  My Lists
                </NavLink>
                <NavLink
                  to="/settings"
                  style={({ isActive }) => ({
                    color: isActive ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  })}
                >
                  Settings
                </NavLink>
              </>
            ) : null}
            {isAdmin ? (
              <NavLink
                to="/admin"
                style={({ isActive }) => ({
                  color: "var(--mr-accent)",
                  fontWeight: isActive ? 700 : 500,
                })}
              >
                Admin
              </NavLink>
            ) : null}
          </nav>
        </div>

        {/* Live Autocomplete Search Box (UC-2.4) */}
        <div ref={containerRef} className="relative flex-1 sm:max-w-xs md:max-w-sm">
          <form onSubmit={handleSearchSubmit} role="search">
            <input
              type="search"
              aria-label="Search manga or creators"
              placeholder="Search manga, alt titles, authors..."
              value={query}
              onFocus={() => {
                if (suggestions.length > 0) setDropdownOpen(true);
              }}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm outline-none"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </form>
          {dropdownOpen && suggestions.length > 0 ? (
            <ul
              role="listbox"
              aria-label="Search suggestions"
              className="absolute right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-[var(--mr-radius-md)] border py-1 shadow-xl"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
              }}
            >
              {suggestions.map((item, idx) => (
                <li
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
                        color: item.type === "MANGA" ? "var(--mr-accent)" : "var(--mr-success)",
                      }}
                    >
                      {item.type}
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
                className="rounded px-2.5 py-1 font-medium"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  color: "var(--mr-text-primary)",
                }}
              >
                {user.displayName}
                {user.role === "ADMIN" ? " · Admin" : ""}
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
    </header>
  );
}
