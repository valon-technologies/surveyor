"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { WorkspaceContext, type WorkspaceMembership } from "@/lib/hooks/use-workspace";
import type { WorkspaceRole } from "@/lib/constants";

const STORAGE_KEY = "surveyor_workspace_id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") return;

    fetch("/api/user/workspaces")
      .then((res) => res.json())
      .then((data: WorkspaceMembership[]) => {
        setWorkspaces(data);

        // Restore from localStorage or use first workspace
        const stored = localStorage.getItem(STORAGE_KEY);
        const valid = data.find((w) => w.id === stored);
        const defaultWs = valid || data[0];

        if (defaultWs) {
          setWorkspaceIdState(defaultWs.id);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [status]);

  const setWorkspaceId = (id: string) => {
    setWorkspaceIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const current = workspaces.find((w) => w.id === workspaceId);

  if (status === "loading" || (status === "authenticated" && isLoading)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Not authenticated — don't block, middleware handles redirect
  if (status !== "authenticated" || !workspaceId) {
    return <>{children}</>;
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceId,
        workspaceName: current?.name || "",
        role: (current?.role as WorkspaceRole) || "viewer",
        workspaces,
        setWorkspaceId,
        isLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
