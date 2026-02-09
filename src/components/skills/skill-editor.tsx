"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SkillContextPicker } from "./skill-context-picker";
import {
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useAddSkillContext,
  useRemoveSkillContext,
} from "@/queries/skill-queries";
import { FIELD_TYPES, type SkillContextRole } from "@/lib/constants";
import type { SkillWithContexts } from "@/types/skill";

interface SkillEditorProps {
  skill?: SkillWithContexts;
}

export function SkillEditor({ skill: existing }: SkillEditorProps) {
  const router = useRouter();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();
  const addContext = useAddSkillContext();
  const removeContext = useRemoveSkillContext();

  const [name, setName] = useState(existing?.name || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [instructions, setInstructions] = useState(
    existing?.instructions || ""
  );
  const [entityPatterns, setEntityPatterns] = useState(
    existing?.applicability?.entityPatterns?.join(", ") || ""
  );
  const [fieldPatterns, setFieldPatterns] = useState(
    existing?.applicability?.fieldPatterns?.join(", ") || ""
  );
  const [dataTypes, setDataTypes] = useState<string[]>(
    existing?.applicability?.dataTypes || []
  );
  const [tags, setTags] = useState(existing?.tags?.join(", ") || "");

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description || "");
      setInstructions(existing.instructions || "");
      setEntityPatterns(
        existing.applicability?.entityPatterns?.join(", ") || ""
      );
      setFieldPatterns(
        existing.applicability?.fieldPatterns?.join(", ") || ""
      );
      setDataTypes(existing.applicability?.dataTypes || []);
      setTags(existing.tags?.join(", ") || "");
    }
  }, [existing]);

  const parseCSV = (str: string) =>
    str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const buildApplicability = () => {
    const ep = parseCSV(entityPatterns);
    const fp = parseCSV(fieldPatterns);
    const hasRules =
      ep.length > 0 || fp.length > 0 || dataTypes.length > 0;
    if (!hasRules) return undefined;
    return {
      entityPatterns: ep.length > 0 ? ep : undefined,
      fieldPatterns: fp.length > 0 ? fp : undefined,
      dataTypes: dataTypes.length > 0 ? dataTypes : undefined,
    };
  };

  const handleSave = () => {
    const parsedTags = parseCSV(tags);
    const applicability = buildApplicability();

    if (existing) {
      updateSkill.mutate(
        {
          id: existing.id,
          name,
          description: description || null,
          instructions: instructions || null,
          applicability: applicability || null,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        },
        { onSuccess: () => router.push("/skills") }
      );
    } else {
      createSkill.mutate(
        {
          name,
          description: description || undefined,
          instructions: instructions || undefined,
          applicability,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        },
        { onSuccess: (data) => router.push(`/skills/${data.id}`) }
      );
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    deleteSkill.mutate(existing.id, {
      onSuccess: () => router.push("/skills"),
    });
  };

  const handleAddContext = (contextId: string, role: SkillContextRole) => {
    if (!existing) return;
    addContext.mutate({ skillId: existing.id, contextId, role });
  };

  const handleRemoveContext = (scId: string) => {
    if (!existing) return;
    removeContext.mutate({ skillId: existing.id, scId });
  };

  const toggleDataType = (dt: string) => {
    setDataTypes((prev) =>
      prev.includes(dt) ? prev.filter((d) => d !== dt) : [...prev, dt]
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name, e.g. 'Escrow Mapping'"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this skill..."
          rows={2}
        />
      </div>

      {/* Instructions */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Instructions (Markdown)</label>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Prompt guidance for LLM when this skill is applied..."
          className="font-mono text-sm min-h-[120px]"
          rows={5}
        />
      </div>

      {/* Applicability Rules */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Applicability Rules</h3>
        <p className="text-xs text-muted-foreground">
          Define when this skill matches. All patterns use case-insensitive substring matching.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Entity Patterns (comma-separated)</label>
          <Input
            value={entityPatterns}
            onChange={(e) => setEntityPatterns(e.target.value)}
            placeholder="e.g. escrow, payment, loan"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Field Patterns (comma-separated)</label>
          <Input
            value={fieldPatterns}
            onChange={(e) => setFieldPatterns(e.target.value)}
            placeholder="e.g. amount, date, status"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Data Types</label>
          <div className="flex flex-wrap gap-1.5">
            {FIELD_TYPES.map((dt) => (
              <button
                key={dt}
                onClick={() => toggleDataType(dt)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  dataTypes.includes(dt)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-border"
                }`}
              >
                {dt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Tags</label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Comma-separated tags"
        />
      </div>

      {/* Context Picker (only for existing skills) */}
      {existing && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Context Bundle</h3>
          <SkillContextPicker
            skillId={existing.id}
            existingContexts={existing.contexts || []}
            onAdd={handleAddContext}
            onRemove={handleRemoveContext}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={
            !name || createSkill.isPending || updateSkill.isPending
          }
        >
          {createSkill.isPending || updateSkill.isPending
            ? "Saving..."
            : existing
              ? "Update Skill"
              : "Create Skill"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/skills")}>
          Cancel
        </Button>
        {existing && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteSkill.isPending}
            className="ml-auto"
          >
            {deleteSkill.isPending ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>

      {!existing && (
        <p className="text-xs text-muted-foreground">
          Save first, then add contexts to the skill.
        </p>
      )}
    </div>
  );
}
