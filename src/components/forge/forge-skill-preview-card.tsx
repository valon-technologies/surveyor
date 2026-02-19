"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Check,
  X,
  Package,
  FileText,
  BookOpen,
  Library,
  AlertTriangle,
  Ban,
  Landmark,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface SkillContext {
  contextId: string;
  contextName?: string;
  role: "primary" | "reference" | "supplementary";
  tokenCount?: number;
  summary?: string;
}

interface SkillGap {
  description: string;
  severity: "high" | "medium" | "low";
  suggestion?: string;
}

interface ExcludedContext {
  contextId?: string;
  contextName: string;
  tokenCount?: number;
  reason: string;
}

interface IndustryContext {
  contextId?: string | null;
  contextName: string;
  tokenCount?: number;
  relevance: string;
}

interface SkillUpdateData {
  name: string;
  description?: string;
  applicability?: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
  };
  contexts: SkillContext[];
  gaps?: SkillGap[];
  excluded?: ExcludedContext[];
  industryContext?: IndustryContext[];
  totalTokens: number;
  budgetAssessment?: string;
  reasoning?: string; // backward compat
}

interface ForgeSkillPreviewCardProps {
  skillUpdate: Record<string, unknown>;
  onApply: () => void;
  onDismiss: () => void;
  applying: boolean;
  applied: boolean;
  applyResult: {
    action: string;
    skillId: string;
    contextsAdded: number;
    contextsRemoved: number;
    contextsUpdated: number;
  } | null;
}

// ─── Constants ───────────────────────────────────────────────

const ROLE_CONFIG = {
  primary: {
    label: "Primary",
    sublabel: "Core docs the agent MUST read",
    icon: FileText,
    color: "text-blue-700 bg-blue-50 border-blue-200",
    dotColor: "bg-blue-500",
  },
  reference: {
    label: "Reference",
    sublabel: "Enums, rules, conventions",
    icon: BookOpen,
    color: "text-amber-700 bg-amber-50 border-amber-200",
    dotColor: "bg-amber-500",
  },
  supplementary: {
    label: "Supplementary",
    sublabel: "Background & edge cases",
    icon: Library,
    color: "text-gray-700 bg-gray-50 border-gray-200",
    dotColor: "bg-gray-400",
  },
} as const;

const SEVERITY_CONFIG = {
  high: { label: "High", color: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500" },
  medium: { label: "Med", color: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  low: { label: "Low", color: "text-gray-600 bg-gray-50 border-gray-200", dot: "bg-gray-400" },
} as const;

// ─── Helpers ─────────────────────────────────────────────────

function getBudgetPercent(total: number): number {
  // 60K = 100% of ideal max
  return Math.min(Math.round((total / 60_000) * 100), 100);
}

function getBudgetColor(total: number): string {
  if (total < 30_000) return "text-amber-600";
  if (total <= 60_000) return "text-green-600";
  return "text-red-600";
}

function getBudgetBarColor(total: number): string {
  if (total < 30_000) return "bg-amber-400";
  if (total <= 60_000) return "bg-green-500";
  return "bg-red-500";
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Collapsible section ─────────────────────────────────────

function Section({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[10px] text-muted-foreground">({count})</span>
        )}
      </button>
      {open && <div className="mt-1.5 space-y-1">{children}</div>}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────

export function ForgeSkillPreviewCard({
  skillUpdate,
  onApply,
  onDismiss,
  applying,
  applied,
  applyResult,
}: ForgeSkillPreviewCardProps) {
  const data = skillUpdate as unknown as SkillUpdateData;

  if (!data.contexts || data.contexts.length === 0) return null;

  // Group contexts by role
  const byRole = {
    primary: data.contexts.filter((c) => c.role === "primary"),
    reference: data.contexts.filter((c) => c.role === "reference"),
    supplementary: data.contexts.filter((c) => c.role === "supplementary"),
  };

  const totalTokens =
    data.totalTokens ||
    data.contexts.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

  const gaps = data.gaps || [];
  const excluded = data.excluded || [];
  const industryCtx = data.industryContext || [];
  const hasHighGaps = gaps.some((g) => g.severity === "high");

  return (
    <div className="border-b">
      {/* Header */}
      <div className="p-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm">Skill Brief</span>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {/* ── Name + description ────────────────────────────── */}
        <div>
          <p className="font-medium text-sm">{data.name}</p>
          {data.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.description}
            </p>
          )}
          {data.applicability?.entityPatterns &&
            data.applicability.entityPatterns.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {data.applicability.entityPatterns.map((p) => (
                  <span
                    key={p}
                    className="text-[10px] px-1.5 py-0.5 bg-muted rounded font-mono"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}
        </div>

        {/* ── Token budget bar ──────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Token budget</span>
            <span className={getBudgetColor(totalTokens)}>
              {formatTokens(totalTokens)} / 60K
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            {/* Budget segments by role */}
            <div className="h-full flex">
              {(["primary", "reference", "supplementary"] as const).map(
                (role) => {
                  const roleTokens = byRole[role].reduce(
                    (s, c) => s + (c.tokenCount || 0),
                    0
                  );
                  if (roleTokens === 0) return null;
                  const width = Math.max(
                    (roleTokens / 60_000) * 100,
                    1
                  );
                  return (
                    <div
                      key={role}
                      className={`h-full ${ROLE_CONFIG[role].dotColor}`}
                      style={{ width: `${width}%` }}
                      title={`${ROLE_CONFIG[role].label}: ${formatTokens(roleTokens)}`}
                    />
                  );
                }
              )}
            </div>
          </div>
          {data.budgetAssessment && (
            <p className="text-[10px] text-muted-foreground">
              {data.budgetAssessment}
            </p>
          )}
          {/* Legend */}
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            {(["primary", "reference", "supplementary"] as const).map(
              (role) => {
                const roleTokens = byRole[role].reduce(
                  (s, c) => s + (c.tokenCount || 0),
                  0
                );
                if (roleTokens === 0) return null;
                return (
                  <span key={role} className="flex items-center gap-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${ROLE_CONFIG[role].dotColor}`}
                    />
                    {ROLE_CONFIG[role].label} {formatTokens(roleTokens)}
                  </span>
                );
              }
            )}
          </div>
        </div>

        {/* ── Included contexts by role ─────────────────────── */}
        {(["primary", "reference", "supplementary"] as const).map((role) => {
          const items = byRole[role];
          if (items.length === 0) return null;

          const config = ROLE_CONFIG[role];
          const roleTokens = items.reduce(
            (sum, c) => sum + (c.tokenCount || 0),
            0
          );

          return (
            <Section
              key={role}
              title={`${config.label} — ${config.sublabel}`}
              icon={config.icon}
              count={items.length}
            >
              <div className="space-y-1">
                {items.map((ctx) => (
                  <div
                    key={ctx.contextId}
                    className={`text-xs px-2 py-1.5 rounded border ${config.color}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">
                        {ctx.contextName ||
                          ctx.contextId.slice(0, 8) + "..."}
                      </span>
                      {ctx.tokenCount != null && (
                        <span className="text-[10px] ml-2 opacity-60 shrink-0 tabular-nums">
                          {formatTokens(ctx.tokenCount)}
                        </span>
                      )}
                    </div>
                    {ctx.summary && (
                      <p className="mt-0.5 opacity-80 leading-snug">
                        {ctx.summary}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          );
        })}

        {/* ── Gaps ──────────────────────────────────────────── */}
        {gaps.length > 0 && (
          <Section
            title="Gaps & Missing Context"
            icon={AlertTriangle}
            count={gaps.length}
          >
            <div className="space-y-1">
              {gaps.map((gap, i) => {
                const sev = SEVERITY_CONFIG[gap.severity] || SEVERITY_CONFIG.medium;
                return (
                  <div
                    key={i}
                    className={`text-xs px-2 py-1.5 rounded border ${sev.color}`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${sev.dot}`}
                      />
                      <div>
                        <p className="font-medium">{gap.description}</p>
                        {gap.suggestion && (
                          <p className="mt-0.5 opacity-80">
                            Suggestion: {gap.suggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Industry / domain context ─────────────────────── */}
        {industryCtx.length > 0 && (
          <Section
            title="Industry Context"
            icon={Landmark}
            count={industryCtx.length}
          >
            <div className="space-y-1">
              {industryCtx.map((ic, i) => (
                <div
                  key={i}
                  className="text-xs px-2 py-1.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">
                      {ic.contextName}
                    </span>
                    {ic.tokenCount != null && (
                      <span className="text-[10px] ml-2 opacity-60 shrink-0 tabular-nums">
                        {formatTokens(ic.tokenCount)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 opacity-80 leading-snug">
                    {ic.relevance}
                  </p>
                  {!ic.contextId && (
                    <p className="mt-0.5 italic opacity-60">
                      Not in library — recommend creating
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Excluded contexts ──────────────────────────────── */}
        {excluded.length > 0 && (
          <Section
            title="Considered & Excluded"
            icon={Ban}
            count={excluded.length}
            defaultOpen={false}
          >
            <div className="space-y-1">
              {excluded.map((ex, i) => (
                <div
                  key={i}
                  className="text-xs px-2 py-1.5 rounded border text-red-700 bg-red-50/50 border-red-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">
                      {ex.contextName}
                    </span>
                    {ex.tokenCount != null && (
                      <span className="text-[10px] ml-2 opacity-60 shrink-0 tabular-nums line-through">
                        {formatTokens(ex.tokenCount)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 opacity-80 leading-snug">
                    {ex.reason}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Legacy reasoning fallback ──────────────────────── */}
        {data.reasoning && !data.budgetAssessment && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            {data.reasoning}
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────── */}
        {hasHighGaps && !applied && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            High-severity gaps detected — consider addressing before applying.
          </div>
        )}

        {applied && applyResult ? (
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
            <Check className="h-3 w-3 inline mr-1" />
            Skill {applyResult.action}: {applyResult.contextsAdded} added
            {applyResult.contextsRemoved > 0 &&
              `, ${applyResult.contextsRemoved} removed`}
            {applyResult.contextsUpdated > 0 &&
              `, ${applyResult.contextsUpdated} updated`}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onApply}
              disabled={applying}
              className="flex-1"
            >
              <Check className="h-3 w-3 mr-1" />
              {applying ? "Applying..." : "Apply Skill"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDismiss}
              disabled={applying}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
