"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSkill } from "@/queries/skill-queries";
import { SkillEditor } from "@/components/skills/skill-editor";
import { SkillDetailView } from "@/components/skills/skill-detail-view";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Eye } from "lucide-react";

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: skill, isLoading } = useSkill(id);
  const [editing, setEditing] = useState(false);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
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
              {editing ? "Edit skill and manage context bundle" : "Skill overview"}
            </p>
          </div>
        </div>

        {skill && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(!editing)}
          >
            {editing ? (
              <>
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                View
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </>
            )}
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : skill ? (
        editing ? (
          <SkillEditor skill={skill} />
        ) : (
          <SkillDetailView skill={skill} />
        )
      ) : (
        <p className="text-sm text-muted-foreground">Skill not found.</p>
      )}
    </div>
  );
}
