"use client";

import { useSession } from "next-auth/react";
import { useWorkspace } from "@/lib/hooks/use-workspace";

export default function SettingsPage() {
  const { data: session } = useSession();
  const { workspaceName, role } = useWorkspace();

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium">Account</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{session?.user?.name || "—"}</span>
          <span className="text-muted-foreground">Email</span>
          <span>{session?.user?.email || "—"}</span>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium">Workspace</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{workspaceName}</span>
          <span className="text-muted-foreground">Your Role</span>
          <span className="capitalize">{role}</span>
        </div>
      </div>
    </div>
  );
}
