import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../services/authContext";
import type { AuthUser } from "../services/authStore";
import { AppRoutes } from "./router";

export interface AppShellProps {
  initialUser?: AuthUser | null;
}

export function AppProviders({
  children,
  initialUser = null,
}: AppShellProps & { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

export function App({ initialUser = null }: AppShellProps) {
  return (
    <AppProviders initialUser={initialUser}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
