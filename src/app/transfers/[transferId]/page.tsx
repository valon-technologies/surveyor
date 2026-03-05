"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { ArrowLeft, Download, ListChecks } from "lucide-react";

interface TransferDetail {
  id: string;
  name: string;
  clientName: string | null;
  description: string | null;
  status: string;
  stats: {
    totalSourceFields?: number;
    totalTargetFields?: number;
    mappedCount?: number;
    unmappedCount?: number;
    coveragePercent?: number;
    highCount?: number;
    mediumCount?: number;
    lowCount?: number;
    lastGeneratedAt?: string;
  } | null;
  createdAt: string;
}

interface CorrectionRow {
  id: string;
  type: string;
  targetEntity: string;
  targetField: string | null;
  note: string | null;
  sourceFieldName: string | null;
  createdAt: string;
}

export default function TransferDetailPage() {
  const { transferId } = useParams<{ transferId: string }>();
  const { workspaceId } = useWorkspace();

  const { data: transfer, isLoading } = useQuery<TransferDetail>({
    queryKey: ["transfer", transferId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers/${transferId}`);
      if (!res.ok) throw new Error("Failed to load transfer");
      return res.json();
    },
    enabled: !!workspaceId && !!transferId,
  });

  const { data: corrections } = useQuery<CorrectionRow[]>({
    queryKey: ["transfer-corrections", transferId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers/${transferId}/corrections`);
      if (!res.ok) throw new Error("Failed to load corrections");
      return res.json();
    },
    enabled: !!workspaceId && !!transferId,
  });

  if (isLoading || !transfer) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  const s = transfer.stats ?? {};

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <Link href="/transfers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Transfers
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{transfer.name}</h1>
            {transfer.clientName && (
              <p className="text-sm text-muted-foreground mt-0.5">Client: {transfer.clientName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/workspaces/${workspaceId}/transfers/${transferId}/export`}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </a>
            <Link
              href={`/transfers/${transferId}/review`}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ListChecks className="h-3.5 w-3.5" /> Review Queue
            </Link>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Source Fields" value={s.totalSourceFields ?? 0} />
        <StatCard label="VDS Fields" value={s.totalTargetFields ?? 0} />
        <StatCard
          label="Mapped"
          value={s.mappedCount ?? 0}
          sub={s.totalTargetFields ? `${((s.mappedCount ?? 0) / s.totalTargetFields * 100).toFixed(1)}%` : undefined}
        />
        <StatCard label="Unmapped" value={s.unmappedCount ?? 0} />
      </div>

      {/* Confidence breakdown */}
      {(s.highCount || s.mediumCount || s.lowCount) && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">Confidence Breakdown</h3>
          <div className="flex gap-6 text-sm">
            <div><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />HIGH: {s.highCount ?? 0}</div>
            <div><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5" />MEDIUM: {s.mediumCount ?? 0}</div>
            <div><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />LOW: {s.lowCount ?? 0}</div>
          </div>
        </div>
      )}

      {/* Corrections */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">
          Corrections ({corrections?.length ?? 0})
        </h3>
        {!corrections?.length ? (
          <p className="text-sm text-muted-foreground">No corrections yet</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {corrections.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm border-b pb-2 last:border-0">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${c.type === "hard_override" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                  {c.type === "hard_override" ? "Override" : "Injection"}
                </span>
                <div>
                  <span className="font-mono text-xs">
                    {c.targetEntity}{c.targetField ? `.${c.targetField}` : ""}
                  </span>
                  {c.note && <p className="text-muted-foreground mt-0.5 line-clamp-2">{c.note}</p>}
                  {c.sourceFieldName && <p className="text-muted-foreground mt-0.5">Source: {c.sourceFieldName}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {transfer.description && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Description</h3>
          <p className="text-sm text-muted-foreground">{transfer.description}</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value.toLocaleString()}</p>
      {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
