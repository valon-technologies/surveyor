"use client";

import { Suspense } from "react";
import { EvaluationClient } from "./evaluation-client";

export default function EvaluationPage() {
  return (
    <Suspense>
      <EvaluationClient />
    </Suspense>
  );
}
