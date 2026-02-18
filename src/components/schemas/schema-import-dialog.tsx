"use client";

import { useState } from "react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { useCreateSchemaAsset } from "@/queries/schema-queries";
import { SCHEMA_SIDES, SCHEMA_FORMATS } from "@/lib/constants";

const MAX_PDF_SIZE_MB = 10;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

interface SchemaImportDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (asset: { id: string; name: string; side: string }) => void;
}

export function SchemaImportDialog({ open, onClose, onCreated }: SchemaImportDialogProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<"source" | "target">("target");
  const [format, setFormat] = useState("csv");
  const [description, setDescription] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfFileSize, setPdfFileSize] = useState<number>(0);
  const [fileError, setFileError] = useState<string | null>(null);

  const createSchema = useCreateSchemaAsset();
  const isPdf = format === "pdf";

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
      setFormat("pdf");
      setPdfFileName(file.name);
      setPdfFileSize(file.size);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const arrayBuffer = ev.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        setRawContent(btoa(binary));
      };
      reader.readAsArrayBuffer(file);
    } else {
      setFormat("csv");
      setPdfFileName(null);
      setPdfFileSize(0);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setRawContent(ev.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleSubmit = () => {
    if (!name || !rawContent) return;
    createSchema.mutate(
      { name, side, format: format as "csv" | "json" | "sql_ddl" | "pdf", description, rawContent },
      {
        onSuccess: (created) => {
          onCreated?.({ id: created.id, name: created.name, side: created.side });
          setName("");
          setSide("target");
          setFormat("csv");
          setDescription("");
          setRawContent("");
          setPdfFileName(null);
          setPdfFileSize(0);
          setFileError(null);
          onClose();
        },
      }
    );
  };

  const buttonLabel = createSchema.isPending
    ? isPdf
      ? "Extracting schema with AI..."
      : "Importing..."
    : "Import Schema";

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader>
        <h2 className="text-lg font-semibold">Import Schema</h2>
        <p className="text-sm text-muted-foreground">
          Upload a CSV or PDF file to create entities and fields
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
                options={[
                  { value: "source", label: "ServiceMac (Source)" },
                  { value: "target", label: "ValonOS (Target)" },
                ]}
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
            <label className="text-xs font-medium">Upload File</label>
            <Input type="file" accept=".csv,.tsv,.txt,.pdf" onChange={handleFileUpload} />
            {fileError && (
              <p className="text-xs text-red-500">{fileError}</p>
            )}
          </div>

          {isPdf && pdfFileName ? (
            <div className="rounded-md border border-border bg-muted/50 p-3 space-y-1">
              <p className="text-sm font-medium">{pdfFileName}</p>
              <p className="text-xs text-muted-foreground">
                {(pdfFileSize / 1024).toFixed(0)} KB — Content will be extracted using AI when imported
              </p>
            </div>
          ) : (
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
          )}

          <Button
            onClick={handleSubmit}
            disabled={!name || !rawContent || createSchema.isPending}
            className="w-full"
          >
            {buttonLabel}
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
