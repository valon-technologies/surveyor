"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";
import {
  Map,
  Database,
  BookOpen,
  Compass,
  LogOut,
  Settings,
  Zap,
  Sun,
  Shield,
  Scale,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useQuestions } from "@/queries/question-queries";
import { useTheme } from "./theme-provider";
import { useWorkspace } from "@/lib/hooks/use-workspace";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
  requiredRole?: "owner";
  children?: { href: string; label: string }[];
}

const navItems: NavItem[] = [
  {
    href: "/mapping",
    label: "Mapping",
    icon: Map,
    children: [
      { href: "/", label: "Progress Summary" },
      { href: "/mapping", label: "Human Review UI" },
      { href: "/mapping/fields", label: "VDS Fields by Milestone" },
      { href: "/mapping/questions", label: "Questions from Human Review" },
      { href: "/docs", label: "Review Guide" },
    ],
  },
  {
    href: "/context",
    label: "Context",
    icon: BookOpen,
    children: [
      { href: "/context", label: "Library" },
      { href: "/context?tab=skills", label: "Skills" },
    ],
  },
  {
    href: "/data",
    label: "Data",
    icon: Database,
    children: [
      { href: "/data?tab=schemas", label: "Schemas" },
      { href: "/data?tab=preview", label: "Preview" },
      { href: "/data?tab=topology", label: "Topology" },
    ],
  },
  { href: "/ground-truth", label: "Verified Mappings", icon: Scale },
  { href: "/admin", label: "Admin", icon: Shield, requiredRole: "owner" },
];

function NavItemRenderer({
  item,
  pathname,
  navItems: allItems,
  badgeCount,
}: {
  item: NavItem;
  pathname: string;
  navItems: NavItem[];
  badgeCount: number;
}) {
  const [expanded, setExpanded] = useState(
    // Auto-expand if current path matches this item or any child
    item.children
      ? pathname.startsWith(item.href.split("?")[0]) ||
        item.children.some((c) => {
          const base = c.href.split("?")[0];
          return base === "/" ? pathname === "/" : pathname.startsWith(base);
        })
      : false
  );

  const isActive =
    item.href === "/"
      ? pathname === "/"
      : pathname.startsWith(item.href.split("?")[0]) &&
        !allItems.some(
          (other) =>
            other.href !== item.href &&
            other.href.startsWith(item.href.split("?")[0]) &&
            pathname.startsWith(other.href.split("?")[0])
        );

  const Icon = item.icon;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors w-full",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          )}
        >
          <Icon className="h-4 w-4" />
          {item.label}
          <span className="ml-auto">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        </button>
        {expanded && (
          <div className="ml-4 mt-0.5 space-y-0.5">
            {item.children.map((child) => {
              const childBase = child.href.split("?")[0];
              const childParams = new URL(child.href, "http://x").searchParams;
              const childTab = childParams.get("tab");
              const currentTab = typeof window !== "undefined"
                ? new URLSearchParams(window.location.search).get("tab")
                : null;

              let childActive: boolean;
              if (childBase === "/") {
                // Root path — exact match only
                childActive = pathname === "/";
              } else if (childBase === item.href.split("?")[0] && !childTab) {
                // Child links to same base as parent with no tab — active when on that exact path
                childActive = pathname === childBase;
              } else if (childTab) {
                // Child has a tab param — active when path matches and tab matches
                childActive = pathname.startsWith(childBase) && currentTab === childTab;
              } else {
                // Child links to a completely different route
                childActive = pathname.startsWith(childBase);
              }

              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    "flex items-center gap-2.5 pl-5 pr-3 py-1.5 rounded-lg text-sm transition-colors",
                    childActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
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
}

export function SidebarNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { role } = useWorkspace();
  const { data: openQuestions } = useQuestions({ status: "open" });
  const { theme, toggle } = useTheme();

  const visibleItems = navItems.filter(
    (item) => !item.requiredRole || role === item.requiredRole,
  );

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
        {visibleItems.map((item) => (
          <NavItemRenderer
            key={item.href}
            item={item}
            pathname={pathname}
            navItems={visibleItems}
            badgeCount={item.badge ? (openQuestions?.length || 0) : 0}
          />
        ))}
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
