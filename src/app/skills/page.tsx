"use client";

import Link from "next/link";
import { SkillList } from "@/components/skills/skill-list";
import { AssemblySimulator } from "@/components/skills/assembly-simulator";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function SkillsPage() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Curated context bundles for mapping tasks
          </p>
        </div>
        <Link href="/skills/new">
          <Button>
            <Plus className="h-4 w-4 mr-1.5" />
            New Skill
          </Button>
        </Link>
      </div>

      <SkillList />

      <div className="border-t pt-6">
        <AssemblySimulator />
      </div>
    </div>
  );
}
