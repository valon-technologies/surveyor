"use client";

import { Suspense } from "react";
import { AtlasClient } from "./atlas-client";

export default function AtlasPage() {
  return (
    <Suspense>
      <AtlasClient />
    </Suspense>
  );
}
