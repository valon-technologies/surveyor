"use client";

import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useEffect, useState, useCallback } from "react";

interface TableStat {
  name: string;
  rows: number;
  sizeBytes: number;
}

interface StorageStats {
  totalSizeBytes: number;
  tables: TableStat[];
}

type PruneTarget = "chat_sessions" | "generations" | "prompt_snapshots";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const TABLE_LABELS: Record<string, string> = {
  chat_message: "Chat Messages",
  chat_session: "Chat Sessions",
  generation: "Generations",
  learning: "Learnings",
  batch_run: "Batch Runs",
  context: "Contexts",
  field_mapping: "Field Mappings",
  entity_pipeline: "Entity Pipelines",
  question: "Questions",
  evaluation: "Evaluations",
  activity: "Activity Log",
  validation: "Validations",
};

const AGE_OPTIONS = [
  { label: "All", value: undefined },
  { label: "Older than 30 days", value: 30 },
  { label: "Older than 60 days", value: 60 },
  { label: "Older than 90 days", value: 90 },
];

export default function StoragePage() {
  const { workspaceId } = useWorkspace();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState<PruneTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PruneTarget | null>(null);
  const [ageFilter, setAgeFilter] = useState<Record<PruneTarget, number | undefined>>({
    chat_sessions: undefined,
    generations: undefined,
    prompt_snapshots: undefined,
  });
  const [lastResult, setLastResult] = useState<{ target: PruneTarget; deleted: number } | null>(null);

  const fetchStats = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/workspaces/${workspaceId}/storage`)
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  async function handlePrune(target: PruneTarget) {
    if (!workspaceId) return;
    setPruning(target);
    setConfirmTarget(null);
    setLastResult(null);

    const res = await fetch(`/api/workspaces/${workspaceId}/storage/prune`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, olderThanDays: ageFilter[target] }),
    });

    const data = await res.json();
    setPruning(null);
    setLastResult({ target, deleted: data.deleted ?? 0 });
    fetchStats();
  }

  if (loading && !stats) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading storage stats...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-destructive">Failed to load storage stats.</p>
      </div>
    );
  }

  const chatRows = stats.tables.find((t) => t.name === "chat_message")?.rows ?? 0;
  const chatSessionRows = stats.tables.find((t) => t.name === "chat_session")?.rows ?? 0;
  const chatSize =
    (stats.tables.find((t) => t.name === "chat_message")?.sizeBytes ?? 0) +
    (stats.tables.find((t) => t.name === "chat_session")?.sizeBytes ?? 0);
  const generationRows = stats.tables.find((t) => t.name === "generation")?.rows ?? 0;
  const generationSize = stats.tables.find((t) => t.name === "generation")?.sizeBytes ?? 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Database size: <strong>{formatBytes(stats.totalSizeBytes)}</strong>
        </p>
      </div>

      {/* Storage Overview */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium">Storage by Table</h2>
        <div className="space-y-1.5">
          {stats.tables
            .filter((t) => t.sizeBytes > 0)
            .map((t) => {
              const pct = (t.sizeBytes / stats.totalSizeBytes) * 100;
              return (
                <div key={t.name} className="flex items-center gap-3 text-sm">
                  <span className="w-36 truncate text-muted-foreground">
                    {TABLE_LABELS[t.name] || t.name}
                  </span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground/30 rounded-full"
                      style={{ width: `${Math.max(pct, 0.5)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums">
                    {formatBytes(t.sizeBytes)}
                  </span>
                  {t.rows > 0 && (
                    <span className="w-20 text-right text-muted-foreground tabular-nums">
                      {formatNumber(t.rows)} rows
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Prune Chat History */}
      <PruneCard
        title="Prune Chat History"
        description="Chat transcripts from AI discuss sessions. Mappings and learnings are preserved."
        detail={`${formatNumber(chatSessionRows)} sessions, ${formatNumber(chatRows)} messages — ${formatBytes(chatSize)}`}
        target="chat_sessions"
        ageFilter={ageFilter}
        setAgeFilter={setAgeFilter}
        confirmTarget={confirmTarget}
        setConfirmTarget={setConfirmTarget}
        pruning={pruning}
        lastResult={lastResult}
        onPrune={handlePrune}
      />

      {/* Prune Prompt Snapshots */}
      <PruneCard
        title="Prune Prompt Snapshots"
        description="Clear prompt snapshot data from generation records. Keeps outputs and metadata intact."
        detail={`${formatNumber(generationRows)} generations — ${formatBytes(generationSize)} total`}
        target="prompt_snapshots"
        ageFilter={ageFilter}
        setAgeFilter={setAgeFilter}
        confirmTarget={confirmTarget}
        setConfirmTarget={setConfirmTarget}
        pruning={pruning}
        lastResult={lastResult}
        onPrune={handlePrune}
      />

      {/* Prune Generations */}
      <PruneCard
        title="Prune Generations"
        description="Delete all generation records including outputs. Mappings are preserved separately."
        detail={`${formatNumber(generationRows)} records — ${formatBytes(generationSize)}`}
        target="generations"
        ageFilter={ageFilter}
        setAgeFilter={setAgeFilter}
        confirmTarget={confirmTarget}
        setConfirmTarget={setConfirmTarget}
        pruning={pruning}
        lastResult={lastResult}
        onPrune={handlePrune}
      />

    </div>
  );
}

function PruneCard({
  title,
  description,
  detail,
  target,
  ageFilter,
  setAgeFilter,
  confirmTarget,
  setConfirmTarget,
  pruning,
  lastResult,
  onPrune,
}: {
  title: string;
  description: string;
  detail: string;
  target: PruneTarget;
  ageFilter: Record<PruneTarget, number | undefined>;
  setAgeFilter: React.Dispatch<React.SetStateAction<Record<PruneTarget, number | undefined>>>;
  confirmTarget: PruneTarget | null;
  setConfirmTarget: (t: PruneTarget | null) => void;
  pruning: PruneTarget | null;
  lastResult: { target: PruneTarget; deleted: number } | null;
  onPrune: (target: PruneTarget) => void;
}) {
  const isConfirming = confirmTarget === target;
  const isPruning = pruning === target;
  const showResult = lastResult?.target === target;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        <p className="text-xs text-muted-foreground mt-1 tabular-nums">{detail}</p>
      </div>

      <div className="flex items-center gap-3">
        <select
          className="text-xs border rounded px-2 py-1.5 bg-background"
          value={ageFilter[target] ?? ""}
          onChange={(e) =>
            setAgeFilter((prev) => ({
              ...prev,
              [target]: e.target.value ? Number(e.target.value) : undefined,
            }))
          }
        >
          {AGE_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value ?? ""}>
              {opt.label}
            </option>
          ))}
        </select>

        {!isConfirming ? (
          <button
            className="text-xs px-3 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            disabled={isPruning}
            onClick={() => setConfirmTarget(target)}
          >
            Prune
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive font-medium">Are you sure?</span>
            <button
              className="text-xs px-3 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              disabled={isPruning}
              onClick={() => onPrune(target)}
            >
              {isPruning ? "Pruning..." : "Confirm"}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded border hover:bg-accent transition-colors"
              onClick={() => setConfirmTarget(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {showResult && (
        <p className="text-xs text-emerald-600">
          {lastResult.deleted === 0
            ? "Nothing to prune."
            : `Pruned ${formatNumber(lastResult.deleted)} ${target === "prompt_snapshots" ? "snapshots" : "records"}.`}
        </p>
      )}
    </div>
  );
}
