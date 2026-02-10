"use client";

import { useState, useRef, useEffect } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";

export function WorkspaceSwitcher() {
  const { workspaceId, workspaceName, workspaces, setWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const ws = await api.post<{ id: string }>("/api/user/workspaces", {
      name: newName.trim(),
    });
    setWorkspaceId(ws.id);
    setNewName("");
    setCreating(false);
    setOpen(false);
    router.refresh();
  };

  if (workspaces.length <= 1 && !open) {
    return (
      <div className="px-4 py-2 border-b">
        <p className="text-xs font-medium text-sidebar-foreground/70 truncate">
          {workspaceName}
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative border-b">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-sidebar-accent/50 transition-colors"
      >
        <span className="text-xs font-medium text-sidebar-foreground/70 truncate">
          {workspaceName}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-sidebar-foreground/50 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-popover border rounded-b-lg shadow-md">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => {
                setWorkspaceId(ws.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-accent transition-colors"
            >
              {ws.id === workspaceId && <Check className="h-3 w-3" />}
              <span className={cn("truncate", ws.id !== workspaceId && "pl-5")}>
                {ws.name}
              </span>
              <span className="ml-auto text-muted-foreground capitalize text-[10px]">
                {ws.role}
              </span>
            </button>
          ))}

          {creating ? (
            <div className="p-2 border-t">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Workspace name"
                className="w-full px-2 py-1 text-xs border rounded"
              />
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors border-t"
            >
              <Plus className="h-3 w-3" />
              Create Workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
