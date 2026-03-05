import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  transfer,
  fieldMapping,
  field,
  entity,
} from "@/lib/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;

  // Verify transfer belongs to workspace
  const [t] = await db
    .select({ id: transfer.id })
    .from(transfer)
    .where(and(eq(transfer.id, transferId), eq(transfer.workspaceId, workspaceId)));

  if (!t) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  // Get all transfer mappings joined with target field + entity for domain info
  const mappings = await db
    .select({
      mappingId: fieldMapping.id,
      status: fieldMapping.status,
      confidence: fieldMapping.confidence,
      domainTags: entity.domainTags,
      requirementType: field.requirementType,
      hasSource: sql<boolean>`${fieldMapping.sourceFieldId} IS NOT NULL`,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(
      and(
        eq(fieldMapping.transferId, transferId),
        eq(fieldMapping.isLatest, true),
      )
    );

  // Count total target fields (non-system, target side) in workspace
  const targetFields = await db
    .select({
      fieldId: field.id,
      domainTags: entity.domainTags,
      requirementType: field.requirementType,
    })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(
      and(
        eq(entity.workspaceId, workspaceId),
        eq(entity.side, "target"),
      )
    );

  // Build domain breakdown
  const domainStats = new Map<string, {
    total: number;
    mapped: number;
    unmapped: number;
    high: number;
    medium: number;
    low: number;
  }>();

  // Index mappings by target for quick lookup (not needed, but build domain-level)
  for (const tf of targetFields) {
    const domain = (tf.domainTags as string[])?.[0] || "unknown";
    if (!domainStats.has(domain)) {
      domainStats.set(domain, { total: 0, mapped: 0, unmapped: 0, high: 0, medium: 0, low: 0 });
    }
    domainStats.get(domain)!.total++;
  }

  for (const m of mappings) {
    const domain = (m.domainTags as string[])?.[0] || "unknown";
    if (!domainStats.has(domain)) {
      domainStats.set(domain, { total: 0, mapped: 0, unmapped: 0, high: 0, medium: 0, low: 0 });
    }
    const ds = domainStats.get(domain)!;
    if (m.status === "unmapped" || !m.hasSource) {
      ds.unmapped++;
    } else {
      ds.mapped++;
      if (m.confidence === "high") ds.high++;
      else if (m.confidence === "medium") ds.medium++;
      else if (m.confidence === "low") ds.low++;
    }
  }

  // Requirement breakdown
  const reqBreakdown = {
    alwaysRequired: { total: 0, mapped: 0 },
    conditionallyRequired: { total: 0, mapped: 0 },
    notRequired: { total: 0, mapped: 0 },
  };

  for (const m of mappings) {
    const rt = m.requirementType;
    if (rt === "ALWAYS_REQUIRED") {
      reqBreakdown.alwaysRequired.total++;
      if (m.status !== "unmapped" && m.hasSource) reqBreakdown.alwaysRequired.mapped++;
    } else if (rt === "CONDITIONALLY_REQUIRED") {
      reqBreakdown.conditionallyRequired.total++;
      if (m.status !== "unmapped" && m.hasSource) reqBreakdown.conditionallyRequired.mapped++;
    } else {
      reqBreakdown.notRequired.total++;
      if (m.status !== "unmapped" && m.hasSource) reqBreakdown.notRequired.mapped++;
    }
  }

  const totalMapped = mappings.filter((m) => m.status !== "unmapped" && m.hasSource).length;
  const totalUnmapped = mappings.length - totalMapped;

  return NextResponse.json({
    total: mappings.length,
    mapped: totalMapped,
    unmapped: totalUnmapped,
    coveragePercent: mappings.length > 0 ? (totalMapped / mappings.length) * 100 : 0,
    domains: Object.fromEntries(domainStats),
    requirements: reqBreakdown,
  });
});
