"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowDownToLine, CheckCircle, AlertCircle } from "lucide-react";
import { useWorkspace } from "@/lib/hooks/use-workspace";

interface PullResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  fieldsCreated: number;
  fieldsUpdated: number;
  mappingsImported: number;
  errors: string[];
}

export function LinearSyncPanel() {
  const { workspaceId } = useWorkspace();
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePull = async () => {
    setPulling(true);
    setError(null);
    setPullResult(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sync/linear/pull`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const result: PullResult = await res.json();
      setPullResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Pull entities, field definitions, and completed mappings from the ServiceMac M2.5 Mapping Fields dashboard in Linear.
        </p>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">ServiceMac Mapping Fields</div>
            <div className="text-xs text-muted-foreground">
              595 issues · 85 entities · 510 fields
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Read-only
          </Badge>
        </div>

        <Button
          onClick={handlePull}
          disabled={pulling}
          className="w-full"
        >
          {pulling ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Pulling from Linear...
            </>
          ) : (
            <>
              <ArrowDownToLine className="h-4 w-4 mr-2" />
              Pull from Linear
            </>
          )}
        </Button>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {pullResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600">
              <CheckCircle className="h-4 w-4" />
              Sync complete
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-muted/50 rounded p-2">
                <span className="text-muted-foreground">Entities created</span>
                <span className="float-right font-mono">{pullResult.entitiesCreated}</span>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <span className="text-muted-foreground">Entities updated</span>
                <span className="float-right font-mono">{pullResult.entitiesUpdated}</span>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <span className="text-muted-foreground">Fields created</span>
                <span className="float-right font-mono">{pullResult.fieldsCreated}</span>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <span className="text-muted-foreground">Fields updated</span>
                <span className="float-right font-mono">{pullResult.fieldsUpdated}</span>
              </div>
              <div className="bg-muted/50 rounded p-2 col-span-2">
                <span className="text-muted-foreground">Mappings imported</span>
                <span className="float-right font-mono">{pullResult.mappingsImported}</span>
              </div>
            </div>

            {pullResult.errors.length > 0 && (
              <div className="text-xs text-amber-600 space-y-1">
                <div className="font-medium">{pullResult.errors.length} warnings:</div>
                {pullResult.errors.slice(0, 10).map((e, i) => (
                  <div key={i} className="truncate">{e}</div>
                ))}
                {pullResult.errors.length > 10 && (
                  <div>...and {pullResult.errors.length - 10} more</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
