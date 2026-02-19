"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useEntitySampleData,
  type FlatSampleData,
  type AssemblySampleData,
} from "@/queries/atlas-queries";
import { SampleDataTable } from "./sample-data-table";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Code,
  Database,
  Layers,
  Loader2,
  RefreshCw,
  Settings,
  AlertTriangle,
  Table,
} from "lucide-react";

export function DataPreview({ entityId }: { entityId: string }) {
  const { data, isLoading, error, isError, refetch } = useEntitySampleData(entityId);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-3 opacity-50" />
        <p className="text-sm">Querying BigQuery...</p>
      </div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : String(error);
    return <ErrorState message={msg} onRetry={() => refetch()} />;
  }

  if (!data) return null;

  if (data.structureType === "flat") {
    return <FlatPreview data={data} onRetry={() => refetch()} />;
  }

  return <AssemblyPreview data={data} onRetry={() => refetch()} />;
}

function FlatPreview({
  data,
  onRetry,
}: {
  data: FlatSampleData;
  onRetry: () => void;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center gap-3 shrink-0">
        <Table className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{data.entityName}</span>
        <span className="text-xs text-muted-foreground">
          {data.result.totalRows} row{data.result.totalRows !== 1 ? "s" : ""}
          {data.result.truncated && " (truncated)"}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-7 text-xs">
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Collapsible SQL viewer */}
      <div className="border-b">
        <button
          onClick={() => setSqlExpanded(!sqlExpanded)}
          className="w-full px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Code className="h-3.5 w-3.5" />
          <span>SQL</span>
          {sqlExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        {sqlExpanded && (
          <pre className="px-4 pb-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
            {data.sql}
          </pre>
        )}
      </div>

      {/* Data table */}
      <div className="flex-1 overflow-auto p-4">
        <SampleDataTable columns={data.columns} rows={data.result.rows} />
      </div>
    </div>
  );
}

function AssemblyPreview({
  data,
  onRetry,
}: {
  data: AssemblySampleData;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center gap-3 shrink-0">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{data.entityName}</span>
        <span className="text-xs text-muted-foreground">
          Assembly &middot; {data.components.length} component
          {data.components.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-7 text-xs">
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Side-by-side component panels */}
      <div className="flex-1 flex overflow-hidden">
        {data.components.map((comp, i) => (
          <ComponentPanel key={comp.alias} comp={comp} isLast={i === data.components.length - 1} />
        ))}
      </div>
    </div>
  );
}

function ComponentPanel({
  comp,
  isLast,
}: {
  comp: AssemblySampleData["components"][number];
  isLast: boolean;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const columns = comp.result.rows.length > 0
    ? [...new Set(comp.result.rows.flatMap((r) => Object.keys(r)))]
    : [];

  return (
    <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${!isLast ? "border-r" : ""}`}>
      {/* Component header */}
      <div className="px-3 py-2 border-b bg-muted/50 shrink-0">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium text-xs truncate">{comp.alias}</span>
          <span className="text-[10px] text-muted-foreground truncate">
            {comp.tableName}
          </span>
        </div>
        {comp.error && (
          <div className="mt-1 text-[10px] text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{comp.error}</span>
          </div>
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {comp.result.totalRows} row{comp.result.totalRows !== 1 ? "s" : ""}
          </span>
          <button
            onClick={() => setSqlExpanded(!sqlExpanded)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
          >
            <Code className="h-3 w-3" />
            SQL
          </button>
        </div>
        {sqlExpanded && (
          <pre className="mt-1 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre max-h-32 overflow-y-auto">
            {comp.sql}
          </pre>
        )}
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto p-2">
        {comp.error && comp.result.rows.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Query failed
          </div>
        ) : (
          <SampleDataTable columns={columns} rows={comp.result.rows} />
        )}
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  // Detect specific error codes from the message
  const isBqNotConfigured = message.includes("BigQuery not configured");
  const isNoPipeline = message.includes("No pipeline found");

  if (isBqNotConfigured) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Settings className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">BigQuery not configured</p>
        <p className="text-xs">
          Configure your BigQuery project and dataset to preview data.
        </p>
        <Link href="/settings">
          <Button variant="outline" size="sm" className="text-xs">
            Go to Settings
          </Button>
        </Link>
      </div>
    );
  }

  if (isNoPipeline) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Database className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No pipeline available</p>
        <p className="text-xs">
          Generate mappings for this entity first, then a pipeline will be auto-created.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
      <AlertTriangle className="h-10 w-10 opacity-30 text-destructive" />
      <p className="text-sm font-medium">Query failed</p>
      <p className="text-xs max-w-md text-center">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="text-xs">
        <RefreshCw className="h-3 w-3 mr-1.5" />
        Retry
      </Button>
    </div>
  );
}
