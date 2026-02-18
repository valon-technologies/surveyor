"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/tag-badge";
import { Progress } from "@/components/ui/progress";
import { useSkill } from "@/queries/skill-queries";
import { groupByRole, formatTokens } from "./skill-utils";
import { SKILL_CONTEXT_ROLE_LABELS, type SkillContextRole } from "@/lib/constants";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { SkillWithCount, SkillContextWithDetail } from "@/types/skill";

const DEFAULT_BUDGET = 160_000;

interface SkillCardProps {
  skill: SkillWithCount;
}

/** Client-side budget simulation: primary always kept, then reference, then supplementary */
function simulateBudget(
  contexts: SkillContextWithDetail[],
  budget: number
) {
  const groups = groupByRole(contexts);
  let totalTokens = 0;
  const kept = new Set<string>();
  const dropped: { id: string; name: string; tokenCount: number; role: SkillContextRole }[] = [];

  // Primary always included
  for (const sc of groups.primary) {
    totalTokens += sc.context.tokenCount || 0;
    kept.add(sc.id);
  }

  // Reference until budget
  for (const sc of groups.reference) {
    const tokens = sc.context.tokenCount || 0;
    if (totalTokens + tokens <= budget) {
      totalTokens += tokens;
      kept.add(sc.id);
    } else {
      dropped.push({ id: sc.id, name: sc.context.name, tokenCount: tokens, role: "reference" });
    }
  }

  // Supplementary until budget
  for (const sc of groups.supplementary) {
    const tokens = sc.context.tokenCount || 0;
    if (totalTokens + tokens <= budget) {
      totalTokens += tokens;
      kept.add(sc.id);
    } else {
      dropped.push({ id: sc.id, name: sc.context.name, tokenCount: tokens, role: "supplementary" });
    }
  }

  return { totalTokens, kept, dropped };
}

export function SkillCard({ skill }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: fullSkill, isLoading: detailLoading } = useSkill(expanded ? skill.id : undefined);

  const preview = skill.description
    ? skill.description.slice(0, 100) + (skill.description.length > 100 ? "..." : "")
    : "No description";

  const app = skill.applicability;

  const { groups, budget } = useMemo(() => {
    if (!fullSkill?.contexts) return { groups: null, budget: null };
    const g = groupByRole(fullSkill.contexts);
    const b = simulateBudget(fullSkill.contexts, DEFAULT_BUDGET);
    return { groups: g, budget: b };
  }, [fullSkill]);

  return (
    <div className="border rounded-lg hover:border-primary/50 transition-colors">
      {/* Header — click to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <h4 className="font-medium text-sm truncate">{skill.name}</h4>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!skill.isActive && (
              <Badge variant="secondary" className="text-[10px]">
                Inactive
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {skill.contextCount} context{skill.contextCount !== 1 ? "s" : ""}
            </Badge>
            <Link
              href={`/skills/${skill.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="View detail page"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{preview}</p>

        {/* Applicability badges */}
        {app && (
          <div className="flex flex-wrap gap-1">
            {app.entityPatterns?.map((p, i) => (
              <Badge key={`ep-${i}-${p}`} variant="secondary" className="text-[10px] font-mono">
                {p}
              </Badge>
            ))}
            {app.fieldPatterns?.map((p, i) => (
              <Badge key={`fp-${i}-${p}`} variant="outline" className="text-[10px] font-mono">
                {p}
              </Badge>
            ))}
            {app.dataTypes?.map((dt, i) => (
              <Badge key={`dt-${i}-${dt}`} variant="outline" className="text-[10px] font-mono">
                {dt}
              </Badge>
            ))}
          </div>
        )}

        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {skill.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          {detailLoading && (
            <p className="text-xs text-muted-foreground">Loading contexts...</p>
          )}

          {groups && budget && (
            <>
              {/* Token budget bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Token usage</span>
                  <span>
                    {formatTokens(budget.totalTokens)} / {formatTokens(DEFAULT_BUDGET)}
                  </span>
                </div>
                <Progress value={budget.totalTokens} max={DEFAULT_BUDGET} />
              </div>

              {/* Context groups */}
              {(["primary", "reference", "supplementary"] as SkillContextRole[]).map((role) => {
                const items = groups[role];
                if (!items.length) return null;
                return (
                  <div key={role} className="space-y-1">
                    <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {SKILL_CONTEXT_ROLE_LABELS[role]}
                    </h5>
                    <div className="space-y-0.5">
                      {items.map((sc) => {
                        const isDropped = !budget.kept.has(sc.id);
                        return (
                          <div
                            key={sc.id}
                            className={`flex items-center justify-between text-xs pl-2 py-0.5 border-l-2 ${
                              isDropped
                                ? "border-muted opacity-40 line-through"
                                : "border-muted"
                            }`}
                          >
                            <span className="truncate mr-2">{sc.context.name}</span>
                            <span className="text-muted-foreground tabular-nums shrink-0">
                              {formatTokens(sc.context.tokenCount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Dropped summary */}
              {budget.dropped.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {budget.dropped.length} context{budget.dropped.length !== 1 ? "s" : ""} would be
                  trimmed at {formatTokens(DEFAULT_BUDGET)} budget
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
