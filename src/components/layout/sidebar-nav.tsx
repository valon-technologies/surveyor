"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Map,
  Globe,
  Database,
  BookOpen,
  PenTool,
  Compass,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mapping", label: "Mapping", icon: Map },
  { href: "/schemas", label: "Schemas", icon: Database },
  { href: "/context", label: "Context", icon: BookOpen },
  { href: "/skills", label: "Skills", icon: PenTool },
  { href: "/atlas", label: "Atlas", icon: Globe },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r bg-sidebar h-screen flex flex-col shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <Compass className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Surveyor</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
