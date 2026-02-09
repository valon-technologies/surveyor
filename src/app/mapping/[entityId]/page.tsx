import { MappingEditorClient } from "./mapping-editor-client";

export default async function MappingEditorPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  return <MappingEditorClient entityId={entityId} />;
}
