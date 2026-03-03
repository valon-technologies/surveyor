"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";
import {
  LayoutDashboard,
  Map,
  Database,
  BookOpen,
  Waypoints,
  Compass,
  LogOut,
  Settings,
  HelpCircle,
  Zap,
  Sun,
  Shield,
  Scale,
  BookOpenCheck,
} from "lucide-react";
import { useQuestions } from "@/queries/question-queries";
import { useTheme } from "./theme-provider";

const navItems = [
  { href: "/docs", label: "Review Guide", icon: BookOpenCheck },
  { href: "/", label: "Progress Summary", icon: LayoutDashboard },
  { href: "/mapping", label: "Mapping", icon: Map },
  { href: "/mapping/questions", label: "Questions", icon: HelpCircle, badge: true },
  { href: "/data", label: "Data", icon: Database },
  { href: "/context", label: "Context", icon: BookOpen },
  { href: "/ground-truth", label: "Ground Truth", icon: Scale },
  { href: "/topology", label: "Topology", icon: Waypoints },
  { href: "/admin", label: "Admin", icon: Shield },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: openQuestions } = useQuestions({ status: "open" });
  const { theme, toggle } = useTheme();

  return (
    <aside className="w-56 border-r bg-sidebar h-screen flex flex-col shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <Compass className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm flex-1">Surveyor</span>
        <button
          onClick={toggle}
          title={theme === "vaporwave" ? "Switch to default" : "Switch to vaporwave"}
          className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
        >
          {theme === "vaporwave" ? <Sun className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Workspace switcher */}
      <WorkspaceSwitcher />

      {/* Nav items */}
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => {
          // Check if another nav item is a more specific match (longer prefix)
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href) &&
                !navItems.some(
                  (other) =>
                    other.href !== item.href &&
                    other.href.startsWith(item.href) &&
                    pathname.startsWith(other.href)
                );
          const Icon = item.icon;

          const badgeCount = item.badge ? (openQuestions?.length || 0) : 0;

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
              {badgeCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      {session?.user && (
        <div className="border-t p-3 space-y-1">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname.startsWith("/settings")
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <div className="flex items-center gap-2.5 px-3 py-2">
            {session.user.image ? (
              <img
                src={session.user.image}
                alt=""
                className="h-5 w-5 rounded-full"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
                {(session.user.name || session.user.email || "?")[0].toUpperCase()}
              </div>
            )}
            <span className="text-xs text-sidebar-foreground/70 truncate flex-1">
              {session.user.name || session.user.email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
