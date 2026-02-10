"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/hooks/use-workspace";

const settingsTabs = [
  { href: "/settings", label: "General", exact: true },
  { href: "/settings/api-keys", label: "API Keys", exact: false },
  { href: "/settings/bigquery", label: "BigQuery", exact: false },
  { href: "/settings/members", label: "Members", exact: false },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { role } = useWorkspace();

  const visibleTabs = settingsTabs.filter((tab) => {
    // Members tab only visible to owners
    if (tab.href === "/settings/members" && role !== "owner") return false;
    return true;
  });

  return (
    <div>
      <div className="border-b px-6">
        <nav className="flex gap-4">
          {visibleTabs.map((tab) => {
            const isActive = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "py-3 text-sm border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
