"use client";

import { useSkills } from "@/queries/skill-queries";
import { SkillCard } from "./skill-card";

export function SkillList() {
  const { data: skills, isLoading } = useSkills();

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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {skills.map((s) => (
        <SkillCard key={s.id} skill={s} />
      ))}
    </div>
  );
}
