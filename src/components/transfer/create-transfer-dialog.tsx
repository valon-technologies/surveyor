"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function CreateTransferDialog({ onClose }: Props) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceFile, setSourceFile] = useState("");
  const [requirementCsv, setRequirementCsv] = useState("");
  const [parsedPreview, setParsedPreview] = useState<
    { position: number; fieldName: string; sampleValue: string }[]
  >([]);

  const handleSourceChange = useCallback((csv: string) => {
    setSourceFile(csv);
    // Quick client-side preview parse
    const lines = csv.trim().split("\n").filter(Boolean);
    if (lines.length < 2) { setParsedPreview([]); return; }
    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const posIdx = headers.findIndex((h) => h === "position" || h === "pos");
    const nameIdx = headers.findIndex((h) => h.includes("name") || h === "field");
    const sampleIdx = headers.findIndex((h) => h.includes("sample") || h === "example");
    if (nameIdx === -1) { setParsedPreview([]); return; }

    const preview = [];
    for (let i = 1; i < Math.min(11, lines.length); i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      preview.push({
        position: posIdx >= 0 ? parseInt(cols[posIdx] || String(i - 1)) : i - 1,
        fieldName: cols[nameIdx] || "",
        sampleValue: sampleIdx >= 0 ? (cols[sampleIdx] || "") : "",
      });
    }
    setParsedPreview(preview);
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          clientName: clientName || undefined,
          description: description || undefined,
          sourceFile,
          requirementCsv: requirementCsv || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-xl border shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">New Transfer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Stockton Servicing Transfer"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Client Name</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g., Stockton"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Source File CSV *</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              CSV with columns: position, field_name, sample_value
            </p>
            <textarea
              value={sourceFile}
              onChange={(e) => handleSourceChange(e.target.value)}
              rows={6}
              placeholder="position,field_name,sample_value&#10;0,Loan Number,123456&#10;1,Borrower Name,John Smith"
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono bg-background resize-none"
            />
          </div>

          {parsedPreview.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Preview ({parsedPreview.length} of {sourceFile.trim().split("\n").length - 1} fields)
              </p>
              <div className="text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">
                {parsedPreview.map((f) => (
                  <div key={f.position} className="flex gap-3">
                    <span className="text-muted-foreground w-8 text-right">[{f.position}]</span>
                    <span className="flex-1">{f.fieldName}</span>
                    {f.sampleValue && (
                      <span className="text-muted-foreground truncate max-w-48">{f.sampleValue}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Requirement Data CSV (optional)</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              CSV with: field_name, requirement_type, entity_type, requirement_detail
            </p>
            <textarea
              value={requirementCsv}
              onChange={(e) => setRequirementCsv(e.target.value)}
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono bg-background resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name || !sourceFile || create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? "Creating..." : "Create Transfer"}
          </button>
        </div>

        {create.isError && (
          <div className="px-6 pb-4">
            <p className="text-sm text-red-600">{(create.error as Error).message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
