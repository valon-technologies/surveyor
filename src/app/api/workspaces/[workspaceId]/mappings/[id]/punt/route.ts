import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, question, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { puntMappingSchema } from "@/lib/validators/review";
import { logActivity } from "@/lib/activity/log-activity";

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;

    const body = await req.json();
    const parsed = puntMappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))
      )
      .get();

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Update mapping
    db.update(fieldMapping)
      .set({
        status: "punted",
        puntNote: parsed.data.note,
        updatedAt: now,
      })
      .where(eq(fieldMapping.id, id))
      .run();

    // Optionally create a question for SM team
    if (parsed.data.assignToSM) {
      // Resolve entity from target field
      const targetField = db
        .select()
        .from(field)
        .where(eq(field.id, mapping.targetFieldId))
        .get();

      db.insert(question)
        .values({
          workspaceId,
          entityId: targetField?.entityId || null,
          fieldId: mapping.targetFieldId,
          question: parsed.data.questionText || parsed.data.note,
          status: "open",
          askedBy: "user",
          priority: parsed.data.priority || "normal",
          targetForTeam: "SM",
          fieldMappingId: id,
          createdByUserId: userId,
        })
        .run();
    }

    logActivity({
      workspaceId,
      fieldMappingId: id,
      entityId: null,
      actorId: userId,
      actorName: "user",
      action: "status_change",
      detail: {
        reviewAction: "punted",
        note: parsed.data.note,
        assignedToSM: parsed.data.assignToSM,
      },
    });

    const updated = db
      .select()
      .from(fieldMapping)
      .where(eq(fieldMapping.id, id))
      .get();

    return NextResponse.json(updated);
  },
  { requiredRole: "editor" }
);
