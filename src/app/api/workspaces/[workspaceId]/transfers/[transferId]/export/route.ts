import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { transfer, fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;

  // Verify transfer exists
  const [t] = await db
    .select()
    .from(transfer)
    .where(and(eq(transfer.id, transferId), eq(transfer.workspaceId, workspaceId)));

  if (!t) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  // Join field_mapping with target field, source field, target entity
  const rows = await db
    .select({
      // Target field info
      targetFieldName: field.name,
      targetFieldType: field.dataType,
      targetFieldRequired: field.isRequired,
      targetFieldRequirementType: field.requirementType,
      targetFieldRequirementDetail: field.requirementDetail,
      // Target entity info
      targetEntityName: entity.name,
      targetEntityDomainTags: entity.domainTags,
      // Mapping info
      status: fieldMapping.status,
      mappingType: fieldMapping.mappingType,
      sourceFieldId: fieldMapping.sourceFieldId,
      transform: fieldMapping.transform,
      confidence: fieldMapping.confidence,
      reasoning: fieldMapping.reasoning,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(eq(fieldMapping.transferId, transferId));

  // Look up source field details for rows that have a sourceFieldId
  const sourceFieldIds = rows
    .map((r) => r.sourceFieldId)
    .filter((id): id is string => !!id);

  const sourceFieldMap = new Map<string, { name: string; position: number | null }>();
  if (sourceFieldIds.length > 0) {
    const sourceFields = await db
      .select({ id: field.id, name: field.name, position: field.position })
      .from(field)
      .where(
        // Use individual lookups since inArray would need import
        eq(field.entityId, field.entityId), // placeholder — overridden below
      );

    // Actually, fetch all source fields by their IDs
    for (const sfId of [...new Set(sourceFieldIds)]) {
      const [sf] = await db
        .select({ id: field.id, name: field.name, position: field.position })
        .from(field)
        .where(eq(field.id, sfId));
      if (sf) {
        sourceFieldMap.set(sf.id, { name: sf.name, position: sf.position });
      }
    }
  }

  // Build CSV
  const headers = [
    "vds_domain",
    "vds_entity",
    "vds_field",
    "vds_type",
    "vds_required",
    "has_mapping",
    "source_field",
    "source_position",
    "transformation",
    "confidence",
    "reasoning",
    "context_used",
    "follow_up_question",
    "requirement_type",
    "requirement_detail",
    "review_status",
  ];

  const csvRows = rows.map((r) => {
    const domains = (r.targetEntityDomainTags as string[] | null) || [];
    const source = r.sourceFieldId ? sourceFieldMap.get(r.sourceFieldId) : null;
    const hasMapping = r.status !== "unmapped" && !!r.sourceFieldId;

    return [
      domains.join(";"),
      r.targetEntityName,
      r.targetFieldName,
      r.targetFieldType || "",
      r.targetFieldRequired ? "true" : "false",
      hasMapping ? "true" : "false",
      source?.name || "",
      source?.position?.toString() || "",
      r.transform || "",
      r.confidence || "",
      r.reasoning || "",
      "", // context_used
      "", // follow_up_question
      r.targetFieldRequirementType || "",
      r.targetFieldRequirementDetail || "",
      r.status || "",
    ].map(escapeCSV).join(",");
  });

  const csv = [headers.join(","), ...csvRows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${t.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_export.csv"`,
    },
  });
});

function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
