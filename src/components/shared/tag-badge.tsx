"use client";

import { cn } from "@/lib/utils";

const TAG_COLORS = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-orange-100 text-orange-700 border-orange-200",
  "bg-pink-100 text-pink-700 border-pink-200",
  "bg-teal-100 text-teal-700 border-teal-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-lime-100 text-lime-700 border-lime-200",
  "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
] as const;

function hashTag(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface TagBadgeProps {
  tag: string;
  className?: string;
}

export function TagBadge({ tag, className }: TagBadgeProps) {
  const colorClass = TAG_COLORS[hashTag(tag) % TAG_COLORS.length];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium",
        colorClass,
        className
      )}
    >
      {tag}
    </span>
  );
}
