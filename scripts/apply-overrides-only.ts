/**
 * Apply hard overrides directly to existing unmapped transfer mappings.
 * No LLM calls — just updates the DB records mechanically.
 *
 * Usage: npx tsx scripts/apply-overrides-only.ts [--dry-run]
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { db } = await import("../src/lib/db");
  const { fieldMapping, field, entity, transferCorrection } = await import("../src/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const tid = "c5721607-bef7-41be-97dd-77170422d8cf";

  // Load hard overrides
  const overrides = await db.select().from(transferCorrection)
    .where(and(eq(transferCorrection.transferId, tid), eq(transferCorrection.type, "hard_override")));
  console.log(`Hard overrides: ${overrides.length}`);

  // Load latest transfer mappings with field/entity info
  const mappings = await db
    .select({
      id: fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      status: fieldMapping.status,
      version: fieldMapping.version,
      fieldName: field.name,
      entityName: entity.name,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(and(eq(fieldMapping.transferId, tid), eq(fieldMapping.isLatest, true)));

  // Index mappings by entity.field
  const mappingByKey = new Map(mappings.map(m => [
    m.entityName + "." + m.fieldName,
    m,
  ]));

  // Index overrides by entity.field
  const overrideByKey = new Map(overrides.map(o => [
    o.targetEntity + "." + (o.targetField || ""),
    o,
  ]));

  let applied = 0;
  let skipped = 0;
  let created = 0;

  for (const [key, override] of overrideByKey.entries()) {
    const existing = mappingByKey.get(key);

    if (existing && existing.status !== "unmapped") {
      skipped++;
      continue; // Already mapped, don't overwrite
    }

    const transformation = override.transformation || "";

    if (DRY_RUN) {
      console.log(`  ${existing ? "update" : "create"} ${key} → ${transformation.slice(0, 60)}`);
      applied++;
      continue;
    }

    if (existing) {
      // Retire old version
      await db.update(fieldMapping).set({ isLatest: false }).where(eq(fieldMapping.id, existing.id));

      // Create new version with override applied
      await db.insert(fieldMapping).values({
        workspaceId: (await db.select({ wid: fieldMapping.workspaceId }).from(fieldMapping).where(eq(fieldMapping.id, existing.id)))[0].wid,
        targetFieldId: existing.targetFieldId,
        transferId: tid,
        status: "unreviewed",
        mappingType: override.sourceFieldName ? "direct" : "derived",
        sourceFieldId: null, // Will resolve below if source field specified
        transform: transformation,
        defaultValue: transformation.startsWith("literal: ") ? transformation.slice(9) : null,
        reasoning: override.reasoning || override.note || "",
        confidence: "high",
        notes: "Applied from human-reviewed correction",
        createdBy: "import",
        isLatest: true,
        version: existing.version + 1,
        parentId: existing.id,
      });
      applied++;
    } else {
      // No existing mapping — need the target field ID
      // Find it from the field table
      const targetField = mappings.find(m => m.entityName === override.targetEntity && m.fieldName === override.targetField);
      if (targetField) {
        const wsId = (await db.select({ wid: fieldMapping.workspaceId }).from(fieldMapping).where(eq(fieldMapping.transferId, tid)).limit(1))[0]?.wid;
        if (wsId) {
          await db.insert(fieldMapping).values({
            workspaceId: wsId,
            targetFieldId: targetField.targetFieldId,
            transferId: tid,
            status: "unreviewed",
            mappingType: override.sourceFieldName ? "direct" : "derived",
            transform: transformation,
            defaultValue: transformation.startsWith("literal: ") ? transformation.slice(9) : null,
            reasoning: override.reasoning || override.note || "",
            confidence: "high",
            notes: "Applied from human-reviewed correction",
            createdBy: "import",
            isLatest: true,
            version: 1,
          });
          created++;
        }
      } else {
        console.log(`  skip ${key} — no target field found`);
        skipped++;
      }
    }
  }

  console.log(`\nApplied: ${applied} (updated existing unmapped → unreviewed)`);
  console.log(`Created: ${created} (new mappings for fields without any record)`);
  console.log(`Skipped: ${skipped} (already mapped or no target field)`);
  if (DRY_RUN) console.log("(dry run)");

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
