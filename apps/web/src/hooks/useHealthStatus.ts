import { useQuery } from "@tanstack/react-query";
import { apiClient, type ApiSuccessEnvelope, type HealthResponse } from "../services/apiClient";

export function useHealthStatus(enabled: boolean = true) {
  return useQuery<ApiSuccessEnvelope<HealthResponse>>({
    queryKey: ["system", "health"],
    queryFn: ({ signal }) => apiClient.getHealth(signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
