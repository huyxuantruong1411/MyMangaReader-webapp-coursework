export interface FrontendConfig {
  apiBaseUrl: string;
  appTitle: string;
  externalEtlEnabled: boolean;
}

export const frontendConfig: FrontendConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  appTitle: import.meta.env.VITE_APP_TITLE || "Manga Reader",
  externalEtlEnabled: import.meta.env.VITE_EXTERNAL_ETL_ENABLED === "true",
};
