import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { learning, entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { rebuildEntityKnowledge } from "@/lib/generation/entity-knowledge";
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";

// GET: list pending learnings for admin validation
export const GET = withAuth(
  async (req, ctx, { workspaceId }) => {
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status") || "pending";

    const rows = await db
      .select({
        learning: learning,
        entityName: entity.name,
      })
      .from(learning)
      .leftJoin(entity, eq(learning.entityId, entity.id))
      .where(
        and(
          eq(learning.workspaceId, workspaceId),
          eq(learning.validationStatus, status),
        )
      )
      .orderBy(learning.createdAt)
      ;

    // Determine workflow for each learning by checking if entity has transfer mappings
    const entityIds = [...new Set(rows.map((r) => r.learning.entityId).filter(Boolean))] as string[];
    const transferEntityIds = new Set<string>();
    if (entityIds.length > 0) {
      const transferEntities = await db
        .select({ entityId: field.entityId })
        .from(fieldMapping)
        .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
        .where(and(
          isNotNull(fieldMapping.transferId),
          eq(fieldMapping.isLatest, true),
        ))
        .groupBy(field.entityId);
      for (const r of transferEntities) {
        transferEntityIds.add(r.entityId);
      }
    }

    return NextResponse.json(
      rows.map((r) => ({
        ...r.learning,
        entityName: r.entityName,
        workflow: r.learning.source === "client" ? "client"
          : r.learning.entityId && transferEntityIds.has(r.learning.entityId) ? "transfer"
          : "sdt",
      }))
    );
  },
  { requiredRole: "owner" }
);

// PATCH: validate or reject a learning
export const PATCH = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const { learningId, action } = body as {
      learningId: string;
      action: "validate" | "reject";
    };

    if (!learningId || !["validate", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "learningId and action (validate|reject) required" },
        { status: 400 }
      );
    }

    const existing = (await db
      .select()
      .from(learning)
      .where(
        and(eq(learning.id, learningId), eq(learning.workspaceId, workspaceId))
      )
      )[0];

    if (!existing) {
      return NextResponse.json({ error: "Learning not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === "validate") {
      await db.update(learning)
        .set({
          validationStatus: "validated",
          validatedBy: userId,
          validatedAt: now,
        })
        .where(eq(learning.id, learningId))
        ;

      // NOW rebuild Entity Knowledge — the validated correction enters EK
      if (existing.entityId) {
        rebuildEntityKnowledge(workspaceId, existing.entityId);
      }

      // Emit event (using verdict_submitted type for now)
      if (existing.entityId) {
        emitFeedbackEvent({
          workspaceId,
          entityId: existing.entityId,
          eventType: "verdict_submitted",
          payload: {
            learningId,
            content: existing.content,
            validatedBy: userId,
            action: "validated",
          },
        });
      }
    } else {
      await db.update(learning)
        .set({
          validationStatus: "rejected",
          validatedBy: userId,
          validatedAt: now,
        })
        .where(eq(learning.id, learningId))
        ;
    }

    return NextResponse.json({ success: true, action });
  },
  { requiredRole: "owner" }
);
