import { frontendConfig } from "./config";

export interface ApiMeta {
  requestId: string;
  page?: number;
  pageSize?: number;
  total?: number;
  hasNext?: boolean;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: ApiMeta;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "ApiClientError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  environment: string;
  timestampUtc: string;
}

function createClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Centralized HTTP client aligned with `10_API_CONTRACTS_AND_EVENTS.md` and
 * `02_SCREEN_FRAME_EVENT_FLOWS.md` §1.1 (correlation ID, envelope unwrapping,
 * normalized error codes, and single-flight refresh hook ready for Phase 2).
 */
export class ApiClient {
  private readonly baseUrl: string;
  private accessTokenProvider: () => string | null = () => null;
  private onUnauthorizedRefresh: (() => Promise<boolean>) | null = null;
  private inflightRefresh: Promise<boolean> | null = null;

  constructor(baseUrl: string = frontendConfig.apiBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  public configureAuth(options: {
    getAccessToken: () => string | null;
    refreshSession?: () => Promise<boolean>;
  }): void {
    this.accessTokenProvider = options.getAccessToken;
    this.onUnauthorizedRefresh = options.refreshSession ?? null;
  }

  public async request<T>(
    path: string,
    init: RequestInit = {},
    allowRefreshRetry: boolean = true,
  ): Promise<ApiSuccessEnvelope<T>> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("X-Request-ID")) {
      headers.set("X-Request-ID", createClientRequestId());
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const token = this.accessTokenProvider();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${this.baseUrl}${normalizedPath}`, {
      ...init,
      headers,
      credentials: "include",
    });

    if (response.status === 401 && allowRefreshRetry && this.onUnauthorizedRefresh) {
      if (!this.inflightRefresh) {
        this.inflightRefresh = this.onUnauthorizedRefresh().finally(() => {
          this.inflightRefresh = null;
        });
      }
      const refreshed = await this.inflightRefresh;
      if (refreshed) {
        return this.request<T>(path, init, false);
      }
    }

    const responseRequestId = response.headers.get("X-Request-ID") ?? undefined;
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const parsed: unknown = isJson ? await response.json() : null;

    if (!response.ok) {
      const errEnv = parsed as ApiErrorEnvelope | null;
      throw new ApiClientError({
        status: response.status,
        code: errEnv?.error?.code ?? `HTTP_${response.status}`,
        message: errEnv?.error?.message ?? response.statusText ?? "Request failed",
        requestId: errEnv?.meta?.requestId ?? responseRequestId,
        details: errEnv?.error?.details,
      });
    }

    return parsed as ApiSuccessEnvelope<T>;
  }

  public async getHealth(signal?: AbortSignal): Promise<ApiSuccessEnvelope<HealthResponse>> {
    return this.request<HealthResponse>("/health", { method: "GET", signal });
  }
}

export const apiClient = new ApiClient();
