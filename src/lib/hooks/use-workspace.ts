"use client";

import { createContext, useContext } from "react";
import type { WorkspaceRole } from "@/lib/constants";

export interface WorkspaceMembership {
  id: string;
  name: string;
  description: string | null;
  role: string;
}

interface WorkspaceContextValue {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  workspaces: WorkspaceMembership[];
  setWorkspaceId: (id: string) => void;
  isLoading: boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
