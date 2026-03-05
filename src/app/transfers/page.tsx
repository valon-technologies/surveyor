"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { CreateTransferDialog } from "@/components/transfer/create-transfer-dialog";
import { Plus, ArrowRightLeft } from "lucide-react";

interface TransferRow {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  stats: {
    totalSourceFields?: number;
    totalTargetFields?: number;
    mappedCount?: number;
    unmappedCount?: number;
    coveragePercent?: number;
  } | null;
  createdAt: string;
}

export default function TransfersPage() {
  const { workspaceId } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);

  const { data: transfers, isLoading } = useQuery<TransferRow[]>({
    queryKey: ["transfers", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers`);
      if (!res.ok) throw new Error("Failed to load transfers");
      return res.json();
    },
    enabled: !!workspaceId,
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Servicing Transfers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Map client source files to VDS for data onboarding
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Transfer
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : !transfers?.length ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <ArrowRightLeft className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">No transfers yet</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Create your first transfer
          </button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Source Fields</th>
                <th className="px-4 py-3 font-medium text-right">Coverage</th>
                <th className="px-4 py-3 font-medium text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link href={`/transfers/${t.id}`} className="font-medium text-primary hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.clientName || "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.stats?.totalSourceFields ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.stats?.coveragePercent != null
                      ? `${t.stats.coveragePercent.toFixed(1)}%`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateTransferDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  importing: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  generating: "bg-amber-100 text-amber-700",
  reviewing: "bg-purple-100 text-purple-700",
  complete: "bg-emerald-100 text-emerald-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}
