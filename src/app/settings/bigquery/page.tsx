"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Database, CheckCircle, XCircle, Loader2, LogOut, ExternalLink } from "lucide-react";
import {
  useWorkspaceSettings,
  useUpdateWorkspaceSettings,
  useTestBqConnection,
} from "@/queries/workspace-queries";
import { useBigqueryAuth, useDisconnectBigquery } from "@/queries/bigquery-auth-queries";

export default function BigQuerySettingsPage() {
  const { data: settings, isLoading } = useWorkspaceSettings();
  const updateSettings = useUpdateWorkspaceSettings();
  const testConnection = useTestBqConnection();
  const { data: bqAuth, isLoading: bqAuthLoading } = useBigqueryAuth();
  const disconnect = useDisconnectBigquery();
  const searchParams = useSearchParams();

  const [projectId, setProjectId] = useState("");
  const [sourceDataset, setSourceDataset] = useState("");
  const [targetDataset, setTargetDataset] = useState("");
  const [initialized, setInitialized] = useState(false);

  const justConnected = searchParams.get("bq_connected") === "1";
  const oauthError = searchParams.get("bq_error");

  // Initialize form from settings
  useEffect(() => {
    if (settings && !initialized) {
      setProjectId(settings.bigquery?.projectId || "");
      setSourceDataset(settings.bigquery?.sourceDataset || "");
      setTargetDataset(settings.bigquery?.targetDataset || "");
      setInitialized(true);
    }
  }, [settings, initialized]);

  const handleTest = () => {
    testConnection.mutate({ projectId, sourceDataset });
  };

  const handleSave = () => {
    const bigquery = projectId && sourceDataset
      ? { projectId, sourceDataset, ...(targetDataset ? { targetDataset } : {}) }
      : undefined;
    updateSettings.mutate({ bigquery });
  };

  const isConfigured = !!settings?.bigquery?.projectId;
  const hasChanges =
    projectId !== (settings?.bigquery?.projectId || "") ||
    sourceDataset !== (settings?.bigquery?.sourceDataset || "") ||
    targetDataset !== (settings?.bigquery?.targetDataset || "");

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold">BigQuery Connection</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your Google account to enable BigQuery source table validation.
        </p>
      </div>

      {/* OAuth success banner */}
      {justConnected && (
        <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-700 dark:text-green-300">
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />
            BigQuery connected successfully.
          </span>
        </div>
      )}

      {/* OAuth error banner */}
      {oauthError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5" />
            OAuth error: {oauthError.replace(/_/g, " ")}
          </span>
        </div>
      )}

      {/* Google Account Connection */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Google Account</span>
          </div>
          {bqAuthLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : bqAuth?.connected ? (
            <Badge variant="outline" className="text-xs">
              <CheckCircle className="h-3 w-3 mr-1 text-green-600" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Not connected
            </Badge>
          )}
        </div>

        {bqAuth?.connected ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Authenticated as <span className="font-medium text-foreground">{bqAuth.email || "unknown"}</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              <LogOut className="h-3 w-3 mr-1" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Connect your Google account to grant BigQuery read access for validation.
            </p>
            <Button variant="outline" size="sm" onClick={() => { window.location.href = "/api/auth/bigquery/authorize"; }}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Connect BigQuery
            </Button>
          </div>
        )}
      </div>

      {/* Dataset Configuration */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Dataset Configuration</span>
          {isConfigured && (
            <Badge variant="outline" className="text-xs">
              <CheckCircle className="h-3 w-3 mr-1 text-green-600" />
              Configured
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Project ID <span className="text-red-500">*</span>
          </label>
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="my-gcp-project"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Source Dataset <span className="text-red-500">*</span>
          </label>
          <Input
            value={sourceDataset}
            onChange={(e) => setSourceDataset(e.target.value)}
            placeholder="raw_source_data"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            The dataset containing source tables to validate against.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Target Dataset</label>
          <Input
            value={targetDataset}
            onChange={(e) => setTargetDataset(e.target.value)}
            placeholder="target_schema (optional)"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Optional. The dataset for target/VDS tables if different from source.
          </p>
        </div>

        {/* Test result */}
        {testConnection.data && (
          <div
            className={`rounded-md px-3 py-2 text-xs ${
              testConnection.data.success
                ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
            }`}
          >
            {testConnection.data.success ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5" />
                Connection successful — dataset found.
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5" />
                {testConnection.data.error}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={
              !projectId || !sourceDataset || testConnection.isPending
            }
          >
            {testConnection.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateSettings.isPending || (!hasChanges && isConfigured)}
          >
            {updateSettings.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
