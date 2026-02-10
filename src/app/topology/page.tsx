"use client";

import { Suspense } from "react";
import { TopologyClient } from "./topology-client";

export default function TopologyPage() {
  return (
    <Suspense>
      <TopologyClient />
    </Suspense>
  );
}
