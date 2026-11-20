export interface FrontendConfig {
  apiBaseUrl: string;
  appTitle: string;
}

export const frontendConfig: FrontendConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  appTitle: import.meta.env.VITE_APP_TITLE || "Manga Reader",
};
