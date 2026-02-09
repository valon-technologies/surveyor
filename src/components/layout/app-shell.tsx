"use client";

import { SidebarNav } from "./sidebar-nav";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Mapping editor uses full-screen layout (no sidebar)
  const isFullScreen = pathname.match(/^\/mapping\/[^/]+$/);

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
