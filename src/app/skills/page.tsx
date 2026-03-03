"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Skills page now lives under /context?tab=skills.
 * This page redirects for any direct /skills navigations.
 */
export default function SkillsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/context?tab=skills");
  }, [router]);

  return null;
}
