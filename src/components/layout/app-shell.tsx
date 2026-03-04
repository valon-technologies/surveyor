"use client";

import { SidebarNav } from "./sidebar-nav";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Mapping editor, discuss, and auth pages use full-screen layout (no sidebar)
  // Keep sidebar for /mapping/questions, /mapping/fields, and other known sub-pages
  const sidebarPages = ["/mapping/questions", "/mapping/fields"];
  const isFullScreen =
    (pathname.match(/^\/mapping\/[^/]+$/) && !sidebarPages.includes(pathname)) ||
    pathname.startsWith("/mapping/discuss/") ||
    pathname.startsWith("/mapping/discuss-entity/") ||
    pathname.startsWith("/auth");

  if (isFullScreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
