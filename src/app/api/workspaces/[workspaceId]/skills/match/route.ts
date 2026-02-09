import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const entityName = searchParams.get("entityName")?.toLowerCase() || "";
  const fieldName = searchParams.get("fieldName")?.toLowerCase() || "";
  const dataType = searchParams.get("dataType")?.toUpperCase() || "";

  // Load all active skills
  const skills = db
    .select()
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), eq(skill.isActive, true)))
    .all();

  const matched = skills.filter((s) => {
    const app = s.applicability as {
      entityPatterns?: string[];
      fieldPatterns?: string[];
      dataTypes?: string[];
      subcategories?: string[];
    } | null;

    if (!app) return false;

    let matches = false;

    if (app.entityPatterns && app.entityPatterns.length > 0 && entityName) {
      matches =
        matches ||
        app.entityPatterns.some((p) =>
          entityName.includes(p.toLowerCase())
        );
    }

    if (app.fieldPatterns && app.fieldPatterns.length > 0 && fieldName) {
      matches =
        matches ||
        app.fieldPatterns.some((p) =>
          fieldName.includes(p.toLowerCase())
        );
    }

    if (app.dataTypes && app.dataTypes.length > 0 && dataType) {
      matches =
        matches ||
        app.dataTypes.some((dt) => dt.toUpperCase() === dataType);
    }

    return matches;
  });

  // Add context counts and contexts
  const withContexts = matched.map((s) => {
    const scs = db
      .select()
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .orderBy(skillContext.sortOrder)
      .all();

    const contexts = scs.map((sc) => {
      const ctx = db.select().from(context).where(eq(context.id, sc.contextId)).get();
      return { ...sc, context: ctx };
    });

    return { ...s, contexts, contextCount: contexts.length };
  });

  return NextResponse.json(withContexts);
}
