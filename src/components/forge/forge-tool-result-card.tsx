"use client";

import { useState } from "react";
import {
  Search,
  FolderOpen,
  FileText,
  List,
  Settings2,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Hash,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolExecution } from "@/lib/hooks/use-chat-stream";
import type {
  ForgeClientData,
  ContextPreview,
  ContextDetailPreview,
  SkillPreview,
  SkillDetailPreview,
  MappingFeedbackPreview,
} from "@/lib/generation/forge-tools";

// ─── Icon + label per tool name ──────────────────────────────

const TOOL_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  search_contexts: { icon: Search, label: "Context Search" },
  browse_contexts: { icon: FolderOpen, label: "Context Browse" },
  read_context: { icon: FileText, label: "Context Read" },
  list_target_fields: { icon: List, label: "Target Fields" },
  get_existing_skill: { icon: Settings2, label: "Skill Detail" },
  list_skills: { icon: BookOpen, label: "Skills List" },
  get_mapping_feedback: { icon: BarChart3, label: "Mapping Feedback" },
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Main Card ───────────────────────────────────────────────

interface ForgeToolResultCardProps {
  toolResult: ToolExecution;
}

export function ForgeToolResultCard({ toolResult }: ForgeToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[toolResult.toolName] || {
    icon: Search,
    label: toolResult.toolName,
  };
  const Icon = config.icon;
  const forgeData = toolResult.forgeData;

  const badge = getBadge(forgeData);

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="flex-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 rounded-lg overflow-hidden">
        {/* Collapsed header */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left hover:bg-slate-100/50 dark:hover:bg-slate-700/30 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          )}
          <span className="font-medium text-foreground truncate">
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground truncate flex-1">
            {toolResult.purpose}
          </span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full shrink-0 tabular-nums">
              {badge}
            </span>
          )}
        </button>

        {/* Expanded content */}
        {expanded && forgeData && (
          <div className="px-4 pb-3 border-t border-slate-200 dark:border-slate-700">
            <ExpandedContent data={forgeData} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Badge text ──────────────────────────────────────────────

function getBadge(data?: ForgeClientData): string | null {
  if (!data) return null;
  switch (data.type) {
    case "contexts":
      return data.items.length === 0
        ? "0 results"
        : `${data.items.length} context${data.items.length !== 1 ? "s" : ""}`;
    case "context_detail":
      return data.item.tokenCount ? formatTokens(data.item.tokenCount) + " tokens" : null;
    case "skills":
      return `${data.items.length} skill${data.items.length !== 1 ? "s" : ""}`;
    case "skill_detail":
      return formatTokens(data.item.totalTokens) + " tokens";
    case "fields":
      return `${data.fieldCount} field${data.fieldCount !== 1 ? "s" : ""}`;
    case "mapping_feedback": {
      const s = data.summary;
      return `${s.mapped}/${s.totalFields} mapped`;
    }
  }
}

// ─── Expanded content by type ────────────────────────────────

function ExpandedContent({ data }: { data: ForgeClientData }) {
  switch (data.type) {
    case "contexts":
      return <ContextsGrid items={data.items} />;
    case "context_detail":
      return <ContextDetailCard item={data.item} />;
    case "skills":
      return <SkillsList items={data.items} />;
    case "skill_detail":
      return <SkillDetailCard item={data.item} />;
    case "fields":
      return <FieldsSummary entityName={data.entityName} fieldCount={data.fieldCount} />;
    case "mapping_feedback":
      return <MappingFeedbackCard summary={data.summary} />;
  }
}

// ─── Contexts grid (search/browse) ──────────────────────────

function ContextsGrid({ items }: { items: ContextPreview[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground pt-2">No results found.</p>;
  }

  return (
    <div className="grid gap-1.5 pt-2">
      {items.map((ctx) => {
        const isOpen = expandedId === ctx.id;
        const cat = [ctx.category, ctx.subcategory].filter(Boolean).join(" > ");
        return (
          <button
            key={ctx.id}
            type="button"
            onClick={() => setExpandedId(isOpen ? null : ctx.id)}
            className={cn(
              "text-left text-xs rounded border px-2.5 py-2 transition-colors",
              isOpen
                ? "bg-white dark:bg-slate-800/60 border-slate-300 dark:border-slate-600"
                : "bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/60 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800/40"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground truncate">
                {ctx.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {ctx.tokenCount != null && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatTokens(ctx.tokenCount)}
                  </span>
                )}
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{cat}</span>
            {isOpen && ctx.preview && (
              <p className="mt-1.5 text-muted-foreground leading-relaxed border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5">
                {ctx.preview}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Context detail (read) ──────────────────────────────────

function ContextDetailCard({
  item,
}: {
  item: ContextDetailPreview;
}) {
  const cat = [item.category, item.subcategory].filter(Boolean).join(" > ");
  return (
    <div className="pt-2 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">
          {item.name}
        </span>
        {item.tokenCount != null && (
          <span className="text-muted-foreground tabular-nums">
            {formatTokens(item.tokenCount)} tokens
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{cat}</span>
        {item.truncated && (
          <span className="text-amber-600">truncated</span>
        )}
      </div>
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Full content read by agent.
      </p>
    </div>
  );
}

// ─── Skills list ─────────────────────────────────────────────

function SkillsList({ items }: { items: SkillPreview[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground pt-2">No skills found.</p>;
  }

  return (
    <div className="pt-2 space-y-1">
      {items.map((s) => (
        <div
          key={s.id}
          className="text-xs flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-slate-50/50 dark:bg-slate-800/20 border border-slate-200/60 dark:border-slate-700/50"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-foreground truncate">
              {s.name}
            </span>
            {s.entityPatterns.length > 0 && (
              <span className="text-[10px] px-1 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-mono truncate max-w-[120px]">
                {s.entityPatterns[0]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
            <Hash className="h-2.5 w-2.5" />
            {s.contextCount}
            {!s.isActive && (
              <span className="text-amber-600">inactive</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skill detail ────────────────────────────────────────────

function SkillDetailCard({
  item,
}: {
  item: SkillDetailPreview;
}) {
  const roles = item.contextsByRole;
  return (
    <div className="pt-2 space-y-2">
      <div className="text-xs">
        <span className="font-medium text-foreground">
          {item.name}
        </span>
        {item.description && (
          <p className="text-muted-foreground mt-0.5">{item.description}</p>
        )}
      </div>
      {item.entityPatterns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.entityPatterns.map((p, i) => (
            <span
              key={`${i}-${p}`}
              className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-mono"
            >
              {p}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Primary: {roles.primary}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Reference: {roles.reference}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          Suppl: {roles.supplementary}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Total: {formatTokens(item.totalTokens)} tokens
      </div>
    </div>
  );
}

// ─── Fields summary ──────────────────────────────────────────

function FieldsSummary({
  entityName,
  fieldCount,
}: {
  entityName: string;
  fieldCount: number;
}) {
  return (
    <div className="pt-2 flex items-center gap-2 text-xs text-foreground">
      <List className="h-3.5 w-3.5 text-slate-400" />
      <span>
        <strong>{fieldCount}</strong> field{fieldCount !== 1 ? "s" : ""} for{" "}
        <strong>{entityName}</strong>
      </span>
    </div>
  );
}

// ─── Mapping feedback ────────────────────────────────────────

function MappingFeedbackCard({
  summary,
}: {
  summary: MappingFeedbackPreview;
}) {
  const conf = summary.confidence;
  const total = conf.high + conf.medium + conf.low + conf.unknown;

  return (
    <div className="pt-2 space-y-2">
      <div className="text-xs text-foreground">
        <strong>{summary.entityName}</strong> — {summary.totalFields} fields
      </div>

      {/* Confidence bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden flex">
            {conf.high > 0 && (
              <div
                className="h-full bg-green-500"
                style={{ width: `${(conf.high / total) * 100}%` }}
                title={`High: ${conf.high}`}
              />
            )}
            {conf.medium > 0 && (
              <div
                className="h-full bg-amber-400"
                style={{ width: `${(conf.medium / total) * 100}%` }}
                title={`Medium: ${conf.medium}`}
              />
            )}
            {conf.low > 0 && (
              <div
                className="h-full bg-red-500"
                style={{ width: `${(conf.low / total) * 100}%` }}
                title={`Low: ${conf.low}`}
              />
            )}
            {conf.unknown > 0 && (
              <div
                className="h-full bg-gray-300"
                style={{ width: `${(conf.unknown / total) * 100}%` }}
                title={`Unknown: ${conf.unknown}`}
              />
            )}
          </div>
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            {conf.high > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                High: {conf.high}
              </span>
            )}
            {conf.medium > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Med: {conf.medium}
              </span>
            )}
            {conf.low > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Low: {conf.low}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span>Mapped: {summary.mapped}</span>
        <span>Unmapped: {summary.unmapped}</span>
        {summary.problemFieldCount > 0 && (
          <span className="text-amber-600">
            {summary.problemFieldCount} problem field{summary.problemFieldCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
