"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { WorkspaceProvider } from "./workspace-provider";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";
import { GenerationPoller } from "@/components/generation/generation-poller";
import { GenerationQueue } from "@/components/generation/generation-queue";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <WorkspaceProvider>
            <ToastProvider>
              {children}
              <GenerationPoller />
              <GenerationQueue />
            </ToastProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
