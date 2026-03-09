"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Database, CheckCircle, XCircle, Loader2, Terminal, ChevronDown, RefreshCw, ExternalLink } from "lucide-react";
import {
  useWorkspaceSettings,
  useUpdateWorkspaceSettings,
  useTestBqConnection,
  useBqAuthStatus,
  useBqAuthLogin,
} from "@/queries/workspace-queries";

export default function BigQuerySettingsPage() {
  const { data: settings, isLoading } = useWorkspaceSettings();
  const updateSettings = useUpdateWorkspaceSettings();
  const testConnection = useTestBqConnection();
  const { data: authStatus, refetch: refetchAuth } = useBqAuthStatus();
  const authLogin = useBqAuthLogin();

  const PROJECT_DATASETS: Record<string, string[]> = {
    "service-mac-prod": [
      "raw_acdc_m1",
      "vds_production",
    ],
    "service-mac-stage": [
      "raw_acdc_M2_Fay_trial1",
      "raw_acdc_M2_Lakeview_trial1",
      "raw_acdc_M1_0127",
      "raw_acdc_M1_trial_2",
      "raw_acdc_nexus_nova",
      "vds_production",
    ],
  };

  const [projectId, setProjectId] = useState("");
  const [sourceDataset, setSourceDataset] = useState("");
  const [targetDataset, setTargetDataset] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form from settings
  useEffect(() => {
    if (settings && !initialized) {
      setProjectId(settings.bigquery?.projectId || "");
      setSourceDataset(settings.bigquery?.sourceDataset || "");
      setTargetDataset(settings.bigquery?.targetDataset || "");
      setInitialized(true);
    }
  }, [settings, initialized]);

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    // Auto-set to first available dataset
    const datasets = PROJECT_DATASETS[value];
    setSourceDataset(datasets?.[0] || "");
  };

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
          Connect to BigQuery to enable source table validation for your mappings.
        </p>
      </div>

      {/* Query Auth (ADC) */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Query Authentication</span>
          </div>
          {authStatus && (
            <Badge
              variant="outline"
              className={`text-xs ${
                authStatus.status === "valid"
                  ? "text-green-700 border-green-300"
                  : "text-red-700 border-red-300"
              }`}
            >
              {authStatus.status === "valid" ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Authenticated</>
              ) : authStatus.status === "expired" ? (
                <><XCircle className="h-3 w-3 mr-1" /> Expired</>
              ) : (
                <><XCircle className="h-3 w-3 mr-1" /> Not configured</>
              )}
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          BigQuery queries require Google Application Default Credentials.
          {authStatus?.status !== "valid" && " Click below to authenticate via your browser."}
        </p>

        {authStatus?.status !== "valid" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => authLogin.mutate()}
              disabled={authLogin.isPending}
            >
              {authLogin.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Opening browser...</>
              ) : (
                <><ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Authenticate with Google</>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchAuth()}
              className="text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Check status
            </Button>
          </div>
        )}

        {authLogin.data && !authLogin.data.ok && (
          <p className="text-xs text-red-600">{authLogin.data.error}</p>
        )}

        {authLogin.isSuccess && authLogin.data?.ok && (
          <p className="text-xs text-amber-600">
            Browser opened. Complete the Google sign-in, then click &quot;Check status&quot; to verify.
          </p>
        )}

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Manual setup</summary>
          <p className="mt-1.5">
            Alternatively, run in your terminal:
          </p>
          <pre className="bg-muted/50 border rounded px-3 py-2 text-xs font-mono overflow-x-auto mt-1">
            gcloud auth application-default login
          </pre>
          <p className="mt-1.5">
            For Gestalt metadata (table schemas, etc.), also ensure <code className="text-[11px]">GESTALT_API_KEY</code> is set in <code className="text-[11px]">.env.local</code>.
          </p>
        </details>
      </div>

      {/* Dataset Configuration */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Dataset Configuration</span>
          </div>
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
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Select a project...</option>
              {Object.keys(PROJECT_DATASETS).map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Source Dataset <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={sourceDataset}
              onChange={(e) => setSourceDataset(e.target.value)}
              disabled={!projectId}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {projectId ? "Select a dataset..." : "Select a project first"}
              </option>
              {projectId && PROJECT_DATASETS[projectId]?.map((ds) => (
                <option key={ds} value={ds}>
                  {ds}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
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
