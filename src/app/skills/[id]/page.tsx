"use client";

import { use } from "react";
import Link from "next/link";
import { useSkill } from "@/queries/skill-queries";
import { SkillEditor } from "@/components/skills/skill-editor";
import { ArrowLeft } from "lucide-react";

export default function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: skill, isLoading } = useSkill(id);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/skills"
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isLoading ? "Loading..." : skill?.name || "Skill"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Edit skill and manage context bundle
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : skill ? (
        <SkillEditor skill={skill} />
      ) : (
        <p className="text-sm text-muted-foreground">Skill not found.</p>
      )}
    </div>
  );
}
