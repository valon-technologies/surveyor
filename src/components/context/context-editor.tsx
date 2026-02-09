"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateContext, useUpdateContext, useDeleteContext } from "@/queries/context-queries";
import {
  CONTEXT_CATEGORIES,
  CONTEXT_CATEGORY_LABELS,
  CONTEXT_SUBCATEGORIES,
  CONTEXT_SUBCATEGORY_LABELS,
  type ContextCategory,
  type ContextSubcategory,
} from "@/lib/constants";
import type { Context } from "@/types/context";

interface ContextEditorProps {
  context?: Context;
}

export function ContextEditor({ context: existing }: ContextEditorProps) {
  const router = useRouter();
  const createContext = useCreateContext();
  const updateContext = useUpdateContext();
  const deleteContext = useDeleteContext();

  const [name, setName] = useState(existing?.name || "");
  const [category, setCategory] = useState<ContextCategory>(
    (existing?.category as ContextCategory) || "foundational"
  );
  const [subcategory, setSubcategory] = useState<string>(existing?.subcategory || "");
  const [content, setContent] = useState(existing?.content || "");
  const [tags, setTags] = useState(existing?.tags?.join(", ") || "");

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setCategory(existing.category as ContextCategory);
      setSubcategory(existing.subcategory || "");
      setContent(existing.content);
      setTags(existing.tags?.join(", ") || "");
    }
  }, [existing]);

  const subcategoryOptions = CONTEXT_SUBCATEGORIES[category];

  const handleSave = () => {
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (existing) {
      updateContext.mutate(
        {
          id: existing.id,
          name,
          category,
          subcategory: (subcategory as ContextSubcategory) || null,
          content,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        },
        { onSuccess: () => router.push("/context") }
      );
    } else {
      createContext.mutate(
        {
          name,
          category,
          subcategory: (subcategory as ContextSubcategory) || undefined,
          content,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        },
        { onSuccess: () => router.push("/context") }
      );
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    deleteContext.mutate(existing.id, {
      onSuccess: () => router.push("/context"),
    });
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Context document name"
        />
      </div>

      {/* Category + Subcategory */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Category</label>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ContextCategory);
              setSubcategory("");
            }}
            options={CONTEXT_CATEGORIES.map((c) => ({
              value: c,
              label: CONTEXT_CATEGORY_LABELS[c],
            }))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Subcategory</label>
          <Select
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            options={[
              { value: "", label: "None" },
              ...subcategoryOptions.map((s) => ({
                value: s,
                label: CONTEXT_SUBCATEGORY_LABELS[s as ContextSubcategory],
              })),
            ]}
          />
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

      {/* Content */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Content (Markdown)</label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter context content in markdown..."
          className="font-mono text-sm min-h-[300px]"
          rows={15}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={
            !name || !content || createContext.isPending || updateContext.isPending
          }
        >
          {createContext.isPending || updateContext.isPending
            ? "Saving..."
            : existing
              ? "Update"
              : "Create Context"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/context")}>
          Cancel
        </Button>
        {existing && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteContext.isPending}
            className="ml-auto"
          >
            {deleteContext.isPending ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}
