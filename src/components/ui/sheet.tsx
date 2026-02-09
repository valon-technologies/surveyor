"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  side?: "right" | "left";
  className?: string;
}

export function Sheet({ open, onClose, children, side = "right", className }: SheetProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          "fixed z-50 top-0 h-full w-[480px] bg-background shadow-xl border-l",
          side === "right" ? "right-0" : "left-0 border-l-0 border-r",
          "overflow-y-auto",
          className
        )}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </>
  );
}

export function SheetHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-6 pb-4", className)}>{children}</div>;
}

export function SheetContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-6 pb-6", className)}>{children}</div>;
}
