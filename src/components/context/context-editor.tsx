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
  CONTEXT_TAG_GROUPS,
  CONTEXT_TAG_GROUP_LABELS,
  CONTEXT_TAG_LABELS,
  type ContextCategory,
  type ContextSubcategory,
  type ContextTag,
} from "@/lib/constants";
import type { Context } from "@/types/context";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { workspacePath } from "@/lib/api-client";

const MAX_PDF_SIZE_MB = 10;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

interface ContextEditorProps {
  context?: Context;
}

export function ContextEditor({ context: existing }: ContextEditorProps) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const createContext = useCreateContext();
  const updateContext = useUpdateContext();
  const deleteContext = useDeleteContext();

  const [name, setName] = useState(existing?.name || "");
  const [category, setCategory] = useState<ContextCategory>(
    (existing?.category as ContextCategory) || "foundational"
  );
  const [subcategory, setSubcategory] = useState<string>(existing?.subcategory || "");
  const [content, setContent] = useState(existing?.content || "");
  const [tags, setTags] = useState<Set<string>>(
    new Set(existing?.tags || [])
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setCategory(existing.category as ContextCategory);
      setSubcategory(existing.subcategory || "");
      setContent(existing.content);
      setTags(new Set(existing.tags || []));
    }
  }, [existing]);

  const subcategoryOptions = CONTEXT_SUBCATEGORIES[category];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);

    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "pdf") {
      if (file.size > MAX_PDF_SIZE_BYTES) {
        setFileError(`PDF must be under ${MAX_PDF_SIZE_MB}MB (got ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        return;
      }
      setExtracting(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const arrayBuffer = ev.target?.result as ArrayBuffer;
          const bytes = new Uint8Array(arrayBuffer);
          // Convert in chunks to avoid stack overflow on large files
          const chunks: string[] = [];
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            chunks.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)));
          }
          const base64Content = btoa(chunks.join(""));

          const res = await fetch(workspacePath(workspaceId, "contexts/extract-pdf"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64Content, name: file.name }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `Extraction failed: ${res.status}`);
          }
          const data = await res.json();
          setContent(data.content);
        } catch (err) {
          setFileError(err instanceof Error ? err.message : "PDF extraction failed");
        } finally {
          setExtracting(false);
        }
      };
      reader.onerror = () => {
        setFileError("Failed to read file");
        setExtracting(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV, TSV, TXT — read as text
      const reader = new FileReader();
      reader.onload = (ev) => {
        setContent(ev.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleSave = () => {
    const tagArray = Array.from(tags);

    if (existing) {
      updateContext.mutate(
        {
          id: existing.id,
          name,
          category,
          subcategory: (subcategory as ContextSubcategory) || null,
          content,
          tags: tagArray.length > 0 ? tagArray : undefined,
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
          tags: tagArray.length > 0 ? tagArray : undefined,
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
      <div className="space-y-2">
        <label className="text-sm font-medium">Tags</label>
        {(Object.keys(CONTEXT_TAG_GROUPS) as Array<keyof typeof CONTEXT_TAG_GROUPS>).map(
          (group) => (
            <div key={group} className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {CONTEXT_TAG_GROUP_LABELS[group]}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CONTEXT_TAG_GROUPS[group].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                      tags.has(tag)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {CONTEXT_TAG_LABELS[tag as ContextTag]}
                  </button>
                ))}
              </div>
            </div>
          )
        )}
      </div>

      {/* Content — upload OR manual */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Upload File</label>
          <p className="text-xs text-muted-foreground">
            Upload a CSV, TSV, TXT, or PDF file. PDFs will be analyzed by AI to produce a structured markdown summary.
          </p>
          <Input type="file" accept=".csv,.tsv,.txt,.pdf" onChange={handleFileUpload} disabled={extracting} />
          {fileError && (
            <p className="text-xs text-red-500">{fileError}</p>
          )}
        </div>

        {extracting ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <p className="text-sm font-medium text-blue-700">Parsing PDF with AI...</p>
            </div>
            <p className="text-xs text-blue-600">
              Extracting content, tables, and key information from your document. This may take a minute for larger files. The content will appear below for review once complete.
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or write manually</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Content (Markdown)
                {content && <span className="ml-2 font-normal text-muted-foreground">({content.length.toLocaleString()} chars)</span>}
              </label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter context content in markdown..."
                className="font-mono text-sm min-h-[300px]"
                rows={15}
              />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={
            !name || !content || extracting || createContext.isPending || updateContext.isPending
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
