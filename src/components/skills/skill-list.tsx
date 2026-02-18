"use client";

import { useMemo, useState } from "react";
import { useSkills } from "@/queries/skill-queries";
import { SkillCard } from "./skill-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Layers, Target } from "lucide-react";
import type { SkillWithCount } from "@/types/skill";

/** Field-specific = has fieldPatterns or dataTypes in applicability */
function isFieldSpecific(skill: SkillWithCount): boolean {
  const app = skill.applicability;
  if (!app) return false;
  return (
    (app.fieldPatterns != null && app.fieldPatterns.length > 0) ||
    (app.dataTypes != null && app.dataTypes.length > 0)
  );
}

function SkillGroupSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </section>
  );
}

export function SkillList() {
  const { data: skills, isLoading } = useSkills();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!skills) return [];
    if (!query.trim()) return skills;
    const q = query.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [skills, query]);

  const { entityLevel, fieldSpecific } = useMemo(() => {
    const entityLevel: SkillWithCount[] = [];
    const fieldSpecific: SkillWithCount[] = [];
    for (const s of filtered) {
      if (isFieldSpecific(s)) {
        fieldSpecific.push(s);
      } else {
        entityLevel.push(s);
      }
    }
    return { entityLevel, fieldSpecific };
  }, [filtered]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!skills || skills.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground">No skills yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Create a skill to bundle context documents for mapping tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills by name, description, or tag..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No skills match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="space-y-8">
          {entityLevel.length > 0 && (
            <SkillGroupSection
              title="Entity-Level Skills"
              icon={<Layers className="h-4 w-4 text-muted-foreground" />}
              count={entityLevel.length}
            >
              {entityLevel.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </SkillGroupSection>
          )}

          {fieldSpecific.length > 0 && (
            <SkillGroupSection
              title="Field-Specific Skills"
              icon={<Target className="h-4 w-4 text-muted-foreground" />}
              count={fieldSpecific.length}
            >
              {fieldSpecific.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </SkillGroupSection>
          )}
        </div>
      )}
    </div>
  );
}
