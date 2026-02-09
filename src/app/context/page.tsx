"use client";

import Link from "next/link";
import { ContextLibrary } from "@/components/context/context-library";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function ContextPage() {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Context</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Domain knowledge, schema references, and working documents
          </p>
        </div>
        <Link href="/context/new">
          <Button>
            <Plus className="h-4 w-4 mr-1.5" />
            New Context
          </Button>
        </Link>
      </div>

      <div className="flex-1 overflow-hidden px-8">
        <ContextLibrary />
      </div>
    </div>
  );
}
