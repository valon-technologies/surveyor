"use client";

import { useMemo, useState } from "react";
import { useSkills } from "@/queries/skill-queries";
import { SkillCard } from "./skill-card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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
    <div className="space-y-4">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SkillCard key={s.id} skill={s} />
          ))}
        </div>
      )}
    </div>
  );
}
