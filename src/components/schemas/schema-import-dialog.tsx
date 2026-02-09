"use client";

import { useState } from "react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { useCreateSchemaAsset } from "@/queries/schema-queries";
import { SCHEMA_SIDES, SCHEMA_FORMATS } from "@/lib/constants";

interface SchemaImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SchemaImportDialog({ open, onClose }: SchemaImportDialogProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<"source" | "target">("target");
  const [format, setFormat] = useState("csv");
  const [description, setDescription] = useState("");
  const [rawContent, setRawContent] = useState("");

  const createSchema = useCreateSchemaAsset();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRawContent(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (!name || !rawContent) return;
    createSchema.mutate(
      { name, side, format: format as "csv" | "json" | "sql_ddl", description, rawContent },
      {
        onSuccess: () => {
          setName("");
          setSide("target");
          setFormat("csv");
          setDescription("");
          setRawContent("");
          onClose();
        },
      }
    );
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader>
        <h2 className="text-lg font-semibold">Import Schema</h2>
        <p className="text-sm text-muted-foreground">
          Upload a CSV file to create entities and fields
        </p>
      </SheetHeader>
      <SheetContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Schema name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Side</label>
              <Select
                value={side}
                onChange={(e) => setSide(e.target.value as typeof side)}
                options={SCHEMA_SIDES.map((s) => ({
                  value: s,
                  label: s.charAt(0).toUpperCase() + s.slice(1),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Format</label>
              <Select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                options={SCHEMA_FORMATS.map((f) => ({ value: f, label: f }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Upload CSV</label>
            <Input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Content {rawContent ? `(${rawContent.length.toLocaleString()} chars)` : ""}
            </label>
            <Textarea
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              placeholder="Or paste CSV content directly..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!name || !rawContent || createSchema.isPending}
            className="w-full"
          >
            {createSchema.isPending ? "Importing..." : "Import Schema"}
          </Button>

          {createSchema.isError && (
            <p className="text-xs text-red-500">
              Error: {createSchema.error?.message}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
