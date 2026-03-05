/**
 * Codemod: Convert synchronous Drizzle SQLite calls to async Postgres pattern.
 *
 * Transforms:
 *   .all()  → removes .all(), adds await
 *   .get()  → removes .get(), wraps in array destructure where assigned
 *   .run()  → removes .run(), adds await
 *   .values().run() → removes .run(), adds await
 *   .returning().get() → removes .get(), adds await + [0]
 *
 * Also:
 *   - Removes `import { getSqliteDb } from "@/lib/db"` and related calls
 *   - Updates withTransaction calls from sync to async
 *
 * Usage: npx tsx scripts/codemod-async-db.ts [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = process.cwd();

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function transformFile(filePath: string): { changed: boolean; changes: string[] } {
  const original = readFileSync(filePath, "utf8");
  let content = original;
  const changes: string[] = [];

  // Skip schema.ts and this script
  if (filePath.includes("schema.ts") && filePath.includes("db/")) return { changed: false, changes: [] };
  if (filePath.includes("codemod-async-db")) return { changed: false, changes: [] };
  if (filePath.includes("migrate-sqlite")) return { changed: false, changes: [] };

  // ── Pattern 1: .run() removal ──
  // db.insert(...).values(...).run();  →  await db.insert(...).values(...);
  // db.update(...).set(...).where(...).run();  →  await db.update(...).set(...).where(...);
  // db.delete(...).where(...).run();  →  await db.delete(...).where(...);
  const runPattern = /^(\s*)((?:const\s+\w+\s*=\s*)?)(db|tx)(\.[^;]*?)\.run\(\)\s*;/gm;
  content = content.replace(runPattern, (match, indent, assign, dbVar, chain) => {
    changes.push(`  .run() → await (line ~${match.trim().substring(0, 60)})`);
    // If there was an assignment, keep it; otherwise just await
    if (assign.trim()) {
      return `${indent}${assign}await ${dbVar}${chain};`;
    }
    return `${indent}await ${dbVar}${chain};`;
  });

  // ── Pattern 2: .all() removal ──
  // const rows = db.select().from(table).where(...).all();
  // → const rows = await db.select().from(table).where(...);
  const allPattern = /^(\s*)((?:const|let|var)\s+(?:\[?\w+(?:\s*,\s*\w+)*\]?)\s*=\s*)(db|tx)(\.[^;]*?)\.all\(\)\s*/gm;
  content = content.replace(allPattern, (match, indent, assign, dbVar, chain) => {
    changes.push(`  .all() → await (${assign.trim().substring(0, 40)})`);
    return `${indent}${assign}await ${dbVar}${chain}\n${indent}  `;
  });

  // Standalone .all() without assignment (rare, e.g., in filter chains)
  // Sometimes: db.select().from(table).all().filter(...)
  // This needs: (await db.select().from(table)).filter(...)
  const allChainPattern = /(db|tx)(\.[^;]*?)\.all\(\)(\.[^;]*?);/gm;
  content = content.replace(allChainPattern, (match, dbVar, chain, postChain) => {
    changes.push(`  .all() chained → (await ...) (${match.trim().substring(0, 60)})`);
    return `(await ${dbVar}${chain})${postChain};`;
  });

  // Remaining .all() at end of line (e.g., return db.select()...all())
  content = content.replace(/(db|tx)(\.[^;]*?)\.all\(\)/gm, (match, dbVar, chain) => {
    changes.push(`  .all() inline → await`);
    return `await ${dbVar}${chain}`;
  });

  // ── Pattern 3: .get() removal ──
  // const row = db.select().from(table).where(...).get();
  // → const [row] = await db.select().from(table).where(...).limit(1);
  //
  // But if already destructured: const { id } = db...get();
  // → const [first] = await db...limit(1); then use first
  // This is complex; for simplicity, add [0] access pattern

  // Simple assignment: const row = ...get()
  const getAssignPattern = /^(\s*)(const|let|var)\s+(\w+)\s*=\s*(db|tx)(\.[^;]*?)\.get\(\)\s*;/gm;
  content = content.replace(getAssignPattern, (match, indent, declType, varName, dbVar, chain) => {
    changes.push(`  .get() → [${varName}] = await ...limit(1)`);
    return `${indent}const [${varName}] = await ${dbVar}${chain}.limit(1);`;
  });

  // Chained .get() with optional chaining: ...get()?.field or ...get()!.field
  const getChainedPattern = /(db|tx)(\.[^;]*?)\.get\(\)([?!])/gm;
  content = content.replace(getChainedPattern, (match, dbVar, chain, suffix) => {
    changes.push(`  .get() chained → (await ...limit(1))[0]`);
    return `(await ${dbVar}${chain}.limit(1))[0]${suffix}`;
  });

  // Remaining .get() (inline, in return statements, etc.)
  content = content.replace(/(db|tx)(\.[^;]*?)\.get\(\)/gm, (match, dbVar, chain) => {
    changes.push(`  .get() inline → (await ...limit(1))[0]`);
    return `(await ${dbVar}${chain}.limit(1))[0]`;
  });

  // ── Pattern 4: getSqliteDb references ──
  if (content.includes("getSqliteDb")) {
    changes.push("  WARNING: File uses getSqliteDb() — needs manual conversion");
  }

  // ── Pattern 5: withTransaction sync → async ──
  // withTransaction(() => { ... })  →  await withTransaction(async (tx) => { ... })
  // This is too complex for regex; flag for manual review
  if (content.includes("withTransaction(")) {
    changes.push("  WARNING: File uses withTransaction — needs manual conversion");
  }

  // ── Cleanup: fix double-await ──
  content = content.replace(/await\s+await\s+/g, "await ");

  // ── Cleanup: fix broken multi-line from .all() replacement ──
  // Remove trailing whitespace-only continuations
  content = content.replace(/\n\s*\n(\s+);/gm, ";");

  const changed = content !== original;
  if (changed && !DRY_RUN) {
    writeFileSync(filePath, content);
  }

  return { changed, changes };
}

// Main
const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/lib")];
const allFiles: string[] = [];
for (const dir of dirs) {
  allFiles.push(...findTsFiles(dir));
}

let totalChanged = 0;
let totalChanges = 0;
const warnings: string[] = [];

for (const file of allFiles) {
  const rel = file.replace(ROOT + "/", "");
  const { changed, changes } = transformFile(file);
  if (changes.length > 0) {
    console.log(`${changed ? "✓" : "⚠"} ${rel} (${changes.length} changes)`);
    for (const c of changes) {
      if (c.includes("WARNING")) {
        warnings.push(`${rel}: ${c}`);
      }
    }
    if (changed) totalChanged++;
    totalChanges += changes.length;
  }
}

console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}${totalChanged} files modified, ${totalChanges} changes`);
if (warnings.length > 0) {
  console.log(`\n⚠ Manual attention needed (${warnings.length}):`);
  for (const w of warnings) console.log(`  ${w}`);
}
