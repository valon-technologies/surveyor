import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skillContext, context } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/auth/api-auth";
import { matchSkills } from "@/lib/generation/context-assembler";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const searchParams = req.nextUrl.searchParams;
  const entityName = searchParams.get("entityName") || "";
  const fieldName = searchParams.get("fieldName") || "";
  const dataType = searchParams.get("dataType") || "";

  const matched = matchSkills(workspaceId, entityName, fieldName, dataType);

  // Add context counts and contexts
  const withContexts = matched.map((s) => {
    const scs = db
      .select()
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .orderBy(skillContext.sortOrder)
      .all();

    const contexts = scs.map((sc) => {
      const ctxRow = db.select().from(context).where(eq(context.id, sc.contextId)).get();
      return { ...sc, context: ctxRow };
    });

    return { ...s, contexts, contextCount: contexts.length };
  });

  return NextResponse.json(withContexts);
});
