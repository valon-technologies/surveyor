import { Suspense } from "react";
import { MappingEditorClient } from "./mapping-editor-client";

export default async function MappingEditorPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  return (
    <Suspense>
      <MappingEditorClient entityId={entityId} />
    </Suspense>
  );
}
