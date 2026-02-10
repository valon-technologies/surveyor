import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface BigqueryAuthStatus {
  connected: boolean;
  email?: string;
  createdAt?: string;
}

export function useBigqueryAuth() {
  return useQuery({
    queryKey: ["bigquery-auth"],
    queryFn: () => api.get<BigqueryAuthStatus>("/api/user/bigquery"),
  });
}

export function useDisconnectBigquery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/user/bigquery"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bigquery-auth"] });
    },
  });
}
