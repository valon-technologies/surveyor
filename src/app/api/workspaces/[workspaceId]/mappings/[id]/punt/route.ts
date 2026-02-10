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

    const mapping = (await db
      .select()
      .from(fieldMapping)
      .where(
        and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))
      ))[0];

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Update mapping
    await db.update(fieldMapping)
      .set({
        reviewStatus: "punted",
        puntNote: parsed.data.note,
        updatedAt: now,
      })
      .where(eq(fieldMapping.id, id));

    // Optionally create a question for SM team
    if (parsed.data.assignToSM) {
      // Resolve entity from target field
      const targetField = (await db
        .select()
        .from(field)
        .where(eq(field.id, mapping.targetFieldId)))[0];

      await db.insert(question)
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
        });
    }

    await logActivity({
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

    const updated = (await db
      .select()
      .from(fieldMapping)
      .where(eq(fieldMapping.id, id)))[0];

    return NextResponse.json(updated);
  },
  { requiredRole: "editor" }
);
