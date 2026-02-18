"use client";

import { cn } from "@/lib/utils";

const SIZE_MAP = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

// Deterministic color from string hash
const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

interface AvatarProps {
  name: string | null;
  image?: string | null;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}

export function Avatar({ name, image, size = "md", className }: AvatarProps) {
  const sizeClass = SIZE_MAP[size];

  if (image) {
    return (
      <img
        src={image}
        alt={name ?? "User"}
        className={cn("rounded-full object-cover shrink-0", sizeClass, className)}
      />
    );
  }

  const colorClass = hashColor(name ?? "unknown");

  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center font-medium text-white",
        sizeClass,
        colorClass,
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
