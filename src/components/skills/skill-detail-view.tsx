"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/tag-badge";
import { SKILL_CONTEXT_ROLE_LABELS, type SkillContextRole } from "@/lib/constants";
import type { SkillWithContexts } from "@/types/skill";
import { groupByRole, formatTokens } from "./skill-utils";

interface SkillDetailViewProps {
  skill: SkillWithContexts;
}

export function SkillDetailView({ skill }: SkillDetailViewProps) {
  const groups = groupByRole(skill.contexts || []);
  const totalTokens = (skill.contexts || []).reduce(
    (sum, sc) => sum + (sc.context.tokenCount || 0),
    0
  );
  const app = skill.applicability;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Description */}
      {skill.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {skill.description}
        </p>
      )}

      {/* Instructions */}
      {skill.instructions && (
        <section>
          <article className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {skill.instructions}
            </ReactMarkdown>
          </article>
        </section>
      )}

      {/* Applicability Rules */}
      {app && (app.entityPatterns?.length || app.fieldPatterns?.length || app.dataTypes?.length) && (
        <section className="border rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold">Applicability Rules</h3>
          {app.entityPatterns && app.entityPatterns.length > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground w-28 shrink-0">
                Entity patterns
              </span>
              <div className="flex flex-wrap gap-1">
                {app.entityPatterns.map((p, i) => (
                  <Badge key={`${p}-${i}`} variant="secondary" className="text-xs font-mono">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {app.fieldPatterns && app.fieldPatterns.length > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground w-28 shrink-0">
                Field patterns
              </span>
              <div className="flex flex-wrap gap-1">
                {app.fieldPatterns.map((p, i) => (
                  <Badge key={`${p}-${i}`} variant="secondary" className="text-xs font-mono">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {app.dataTypes && app.dataTypes.length > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground w-28 shrink-0">
                Data types
              </span>
              <div className="flex flex-wrap gap-1">
                {app.dataTypes.map((dt) => (
                  <Badge key={dt} variant="secondary" className="text-xs font-mono">
                    {dt}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Context Bundle */}
      {skill.contexts && skill.contexts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Context Bundle</h3>
            <Badge variant="outline" className="text-[10px]">
              {skill.contexts.length} context{skill.contexts.length !== 1 ? "s" : ""}
            </Badge>
            <span className="text-xs text-muted-foreground">
              ~{formatTokens(totalTokens)} tokens
            </span>
          </div>

          {(["primary", "reference", "supplementary"] as SkillContextRole[]).map((role) => {
            const items = groups[role];
            if (!items.length) return null;
            return (
              <div key={role} className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {SKILL_CONTEXT_ROLE_LABELS[role]}
                </h4>
                <div className="space-y-1">
                  {items.map((sc) => (
                    <div
                      key={sc.id}
                      className="flex items-start gap-2 text-sm pl-2 py-1 border-l-2 border-muted"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{sc.context.name}</span>
                        {sc.notes && (
                          <span className="text-muted-foreground ml-2">
                            &mdash; {sc.notes}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatTokens(sc.context.tokenCount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      )}
    </div>
  );
}
