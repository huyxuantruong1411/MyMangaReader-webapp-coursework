import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../src/app/App";
import { AppRoutes } from "../src/app/router";
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  NotFoundState,
} from "../src/components/StateViews";
import type { AuthUser } from "../src/services/authStore";

function renderRoute(initialPath: string, initialUser: AuthUser | null = null) {
  return render(
    <AppProviders initialUser={initialUser}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

const ACTIVE_READER: AuthUser = {
  accountId: "11111111-1111-4111-8111-111111111111",
  username: "reader01",
  displayName: "Reader One",
  role: "READER",
  status: "ACTIVE",
};

const ACTIVE_ADMIN: AuthUser = {
  accountId: "22222222-2222-4222-8222-222222222222",
  username: "admin01",
  displayName: "Admin One",
  role: "ADMIN",
  status: "ACTIVE",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json", "X-Request-ID": "req-test" }),
      json: async () => ({
        data: {
          status: "ok",
          service: "Manga Reader API",
          version: "0.1.0",
          environment: "test",
          timestampUtc: "2026-11-20T12:00:00.000Z",
        },
        meta: { requestId: "req-test" },
      }),
    }),
  );
});

describe("Frontend Foundation Shell & Routing", () => {
  it("renders home discovery shell", () => {
    renderRoute("/");
    expect(screen.getByRole("heading", { name: /Home \/ Discovery Hub/i })).toBeInTheDocument();
  });

  it("renders public routes with dynamic route parameters", () => {
    renderRoute("/manga/azure-blade/chapter/ch-10");
    expect(screen.getByRole("heading", { name: /Chapter Reader Canvas/i })).toBeInTheDocument();
    expect(screen.getByText("azure-blade")).toBeInTheDocument();
    expect(screen.getByText("ch-10")).toBeInTheDocument();
  });

  it("enforces authenticated boundary for personal routes", () => {
    renderRoute("/reading-lists", null);
    expect(screen.getByRole("heading", { name: /Sign in required/i })).toBeInTheDocument();
  });

  it("allows active reader into authenticated routes", () => {
    renderRoute("/reading-lists/list-42", ACTIVE_READER);
    expect(screen.getByRole("heading", { name: /Reading List Detail/i })).toBeInTheDocument();
    expect(screen.getByText("list-42")).toBeInTheDocument();
  });

  it("blocks non-admin readers from admin layout boundary", () => {
    renderRoute("/admin/etl", ACTIVE_READER);
    expect(
      screen.getByRole("heading", { name: /Administrator access required/i }),
    ).toBeInTheDocument();
  });

  it("renders admin console routes for active admin user", () => {
    renderRoute("/admin/reports", ACTIVE_ADMIN);
    expect(
      screen.getByRole("heading", { name: /Admin — Moderation Reports Queue/i }),
    ).toBeInTheDocument();
  });

  it("renders 404 NotFound fallback for unknown routes", () => {
    renderRoute("/this-route-does-not-exist");
    expect(screen.getByRole("heading", { name: /Page not found/i })).toBeInTheDocument();
  });

  it("renders standardized state components cleanly", () => {
    render(
      <MemoryRouter>
        <LoadingState />
        <EmptyState title="Nothing here" />
        <ErrorState onRetry={() => {}} />
        <ForbiddenState />
        <NotFoundState />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading content...")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("403 Forbidden")).toBeInTheDocument();
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
  });
});
