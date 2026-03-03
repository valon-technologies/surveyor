"use client";

import Link from "next/link";
import { SkillEditor } from "@/components/skills/skill-editor";
import { ArrowLeft } from "lucide-react";

export default function NewSkillPage() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/context?tab=skills"
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Skill</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create a new context bundle
          </p>
        </div>
      </div>

      <SkillEditor />
    </div>
  );
}
