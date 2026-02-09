"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/tag-badge";
import type { SkillWithCount } from "@/types/skill";

interface SkillCardProps {
  skill: SkillWithCount;
}

export function SkillCard({ skill }: SkillCardProps) {
  const preview = skill.description
    ? skill.description.slice(0, 100) + (skill.description.length > 100 ? "..." : "")
    : "No description";

  return (
    <Link
      href={`/skills/${skill.id}`}
      className="block border rounded-lg p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm truncate">{skill.name}</h4>
        <div className="flex items-center gap-1.5 shrink-0">
          {!skill.isActive && (
            <Badge variant="secondary" className="text-[10px]">
              Inactive
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {skill.contextCount} context{skill.contextCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{preview}</p>

      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      )}
    </Link>
  );
}
