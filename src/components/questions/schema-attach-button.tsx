"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Paperclip, Check, Upload } from "lucide-react";
import { useSchemaAssets } from "@/queries/schema-queries";
import { useUpdateQuestion } from "@/queries/question-queries";
import { SchemaImportDialog } from "@/components/schemas/schema-import-dialog";

interface SchemaAttachButtonProps {
  questionId: string;
  currentIds: string[];
}

export function SchemaAttachButton({ questionId, currentIds }: SchemaAttachButtonProps) {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: schemas } = useSchemaAssets();
  const updateMutation = useUpdateQuestion();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (schemaId: string) => {
    const isAttached = currentIds.includes(schemaId);
    const next = isAttached
      ? currentIds.filter((id) => id !== schemaId)
      : [...currentIds, schemaId];
    updateMutation.mutate({ id: questionId, schemaAssetIds: next.length > 0 ? next : null });
  };

  const handleCreated = (asset: { id: string; name: string; side: string }) => {
    const next = [...currentIds, asset.id];
    updateMutation.mutate({ id: questionId, schemaAssetIds: next });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(!open)}>
        <Paperclip className="h-3 w-3" />
        Schema
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-md border bg-popover p-1 shadow-md">
          {schemas && schemas.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {schemas.map((s) => {
                const isAttached = currentIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left"
                    onClick={() => toggle(s.id)}
                  >
                    <div className="w-4 shrink-0">
                      {isAttached && <Check className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <span className="flex-1 truncate">{s.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {s.side}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{s.entityCount}e</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">No schemas yet</p>
          )}
          <div className="border-t mt-1 pt-1">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left text-muted-foreground"
              onClick={() => {
                setOpen(false);
                setImportOpen(true);
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload new...
            </button>
          </div>
        </div>
      )}

      <SchemaImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
