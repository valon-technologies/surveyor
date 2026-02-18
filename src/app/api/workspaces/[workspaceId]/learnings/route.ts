import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { learning } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";

const createLearningSchema = z.object({
  entityId: z.string().nullable().optional(),
  fieldName: z.string().nullable().optional(),
  scope: z.enum(["field", "entity", "workspace"]),
  content: z.string().min(1),
  source: z.enum(["training", "review", "manual"]),
  sessionId: z.string().nullable().optional(),
});

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId");
  const scope = searchParams.get("scope");

  const conditions = [eq(learning.workspaceId, workspaceId)];
  if (entityId) {
    conditions.push(eq(learning.entityId, entityId));
  }
  if (scope) {
    conditions.push(eq(learning.scope, scope));
  }

  const learnings = db
    .select()
    .from(learning)
    .where(and(...conditions))
    .orderBy(desc(learning.createdAt))
    .all();

  return NextResponse.json({ learnings });
});

export const POST = withAuth(
  async (req, _ctx, { workspaceId }) => {
    const body = await req.json();
    const parsed = createLearningSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { entityId, fieldName, scope, content, source, sessionId } =
      parsed.data;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(learning)
      .values({
        id,
        workspaceId,
        entityId: entityId ?? null,
        fieldName: fieldName ?? null,
        scope,
        content,
        source,
        sessionId: sessionId ?? null,
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(learning)
      .where(eq(learning.id, id))
      .get();

    return NextResponse.json(created);
  },
  { requiredRole: "editor" }
);
