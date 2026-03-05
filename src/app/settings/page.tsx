"use client";

import { useSession } from "next-auth/react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import {
  FIELD_DOMAINS,
  FIELD_DOMAIN_LABELS,
  FIELD_DOMAIN_DESCRIPTIONS,
  FIELD_DOMAIN_COLORS,
  type FieldDomain,
} from "@/lib/constants";
import type { UserStats } from "@/app/api/workspaces/[workspaceId]/members/[userId]/stats/route";

export default function SettingsPage() {
  const { data: session } = useSession();
  const { workspaceId, workspaceName, role } = useWorkspace();
  const userId = session?.user?.id;

  const { data: stats } = useQuery({
    queryKey: ["user-stats", workspaceId, userId],
    queryFn: () =>
      api.get<UserStats>(workspacePath(workspaceId, `members/${userId}/stats`)),
    enabled: !!userId,
  });

  const [domains, setDomains] = useState<FieldDomain[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  // Load current domain preferences
  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.domains)) setDomains(data.domains);
        setLoaded(true);
      });
  }, []);

  function toggleDomain(d: FieldDomain) {
    const next = domains.includes(d)
      ? domains.filter((x) => x !== d)
      : [...domains, d];
    setDomains(next);
    setSaved(false);

    startSave(async () => {
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: next }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium">Account</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{session?.user?.name || "—"}</span>
          <span className="text-muted-foreground">Email</span>
          <span>{session?.user?.email || "—"}</span>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium">Workspace</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{workspaceName}</span>
          <span className="text-muted-foreground">Your Role</span>
          <span className="capitalize">{role}</span>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">Domain Specialties</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select the domains you specialize in. Fields will be auto-assigned to you based on these preferences.
            </p>
          </div>
          {saving && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
          {saved && !saving && (
            <span className="text-xs text-emerald-600">Saved</span>
          )}
        </div>

        {loaded && (
          <div className="grid gap-2">
            {FIELD_DOMAINS.map((d) => {
              const active = domains.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDomain(d)}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-foreground/20 bg-accent"
                      : "border-transparent hover:bg-accent/50"
                  }`}
                >
                  <span
                    className="mt-0.5 h-3 w-3 shrink-0 rounded-full border-2"
                    style={{
                      borderColor: FIELD_DOMAIN_COLORS[d],
                      backgroundColor: active ? FIELD_DOMAIN_COLORS[d] : "transparent",
                    }}
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{FIELD_DOMAIN_LABELS[d]}</span>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {FIELD_DOMAIN_DESCRIPTIONS[d]}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {domains.length === 0 && loaded && (
          <p className="text-xs text-muted-foreground italic">
            No domains selected — you&apos;ll be eligible for fields across all domains.
          </p>
        )}
      </div>

      {/* Stats Dashboard */}
      {stats && (
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-medium">Your Stats</h2>

          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-2xl font-semibold">{stats.totalReviewed}</span>
              <span className="text-muted-foreground ml-1.5">fields reviewed</span>
            </div>
            <div>
              <span className="text-2xl font-semibold">{stats.totalQuestionsAnswered}</span>
              <span className="text-muted-foreground ml-1.5">questions answered</span>
            </div>
            {stats.rank > 0 && (
              <div className="ml-auto text-right">
                <span className="text-lg font-semibold">#{stats.rank}</span>
                <span className="text-muted-foreground ml-1 text-xs">rank</span>
              </div>
            )}
          </div>

          {stats.domainStats.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Domain Breakdown</h3>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted text-xs text-muted-foreground">
                      <th className="px-3 py-1.5 text-left font-medium">Domain</th>
                      <th className="px-3 py-1.5 text-right font-medium">Reviewed</th>
                      <th className="px-3 py-1.5 text-right font-medium">Acceptance %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stats.domainStats.map((d) => (
                      <tr key={d.domain} className="hover:bg-muted/30">
                        <td className="px-3 py-1.5 flex items-center gap-2">
                          {stats.strengths.includes(d.domain) && (
                            <span className="text-amber-500 text-xs">★</span>
                          )}
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: FIELD_DOMAIN_COLORS[d.domain] }}
                          />
                          {FIELD_DOMAIN_LABELS[d.domain]}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{d.reviewed}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <span className={d.acceptanceRate >= 80 ? "text-green-600" : d.acceptanceRate >= 60 ? "text-amber-600" : "text-red-500"}>
                            {d.acceptanceRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stats.strengths.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  ★ = strength (top domain by volume, {">"}80% acceptance)
                </p>
              )}
            </div>
          )}

          {stats.totalReviewed === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No reviewed mappings yet. Start reviewing to build your stats.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
