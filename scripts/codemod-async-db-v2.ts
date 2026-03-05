/**
 * Codemod v2: More aggressive conversion of .all()/.get()/.run() patterns.
 * Handles multiline chains and edge cases missed by v1.
 *
 * Usage: npx tsx scripts/codemod-async-db-v2.ts [--dry-run]
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

function transformFile(filePath: string): { changed: boolean; changes: number } {
  const original = readFileSync(filePath, "utf8");
  let content = original;
  let changes = 0;

  // Skip files we shouldn't touch
  if (filePath.includes("schema.ts") && filePath.includes("db/")) return { changed: false, changes: 0 };
  if (filePath.includes("codemod-async-db")) return { changed: false, changes: 0 };
  if (filePath.includes("migrate-sqlite")) return { changed: false, changes: 0 };
  if (filePath.includes("seed.ts") && filePath.includes("db/")) return { changed: false, changes: 0 };

  // Strategy: Find .all(), .get(), .run() and work backwards to add await
  // This handles multiline chains.

  // ── Pass 1: Remove .run() and ensure await ──
  // Match: anything ending in .run(); or .run()
  content = content.replace(/\.run\(\)\s*;/g, () => {
    changes++;
    return ";";
  });

  // ── Pass 2: Remove .all() and ensure the result is awaited ──
  // Match: .all() at end of expression (may be followed by ; or chained)
  // Replace .all() with nothing — the Drizzle query builder returns a Promise
  content = content.replace(/\.all\(\)/g, () => {
    changes++;
    return "";
  });

  // ── Pass 3: Remove .get() and add [0] access ──
  // .get() → removes .get(), but we need [0] to get the first element
  // Pattern: = something.get(); → = (await something)[0]; or just .limit(1) then [0]
  // Simpler: just replace .get() with [0] and let the Promise be awaited
  content = content.replace(/\.get\(\)/g, () => {
    changes++;
    return "[0]";
  });

  // ── Pass 4: Add await to db/tx operations that need it ──
  // Find lines with db. or tx. operations that return promises (select, insert, update, delete)
  // but don't have await yet

  const lines = content.split("\n");
  const newLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip import lines, comments, type definitions
    if (line.trimStart().startsWith("import ") ||
        line.trimStart().startsWith("//") ||
        line.trimStart().startsWith("*") ||
        line.trimStart().startsWith("type ") ||
        line.trimStart().startsWith("interface ") ||
        line.trimStart().startsWith("export type ") ||
        line.trimStart().startsWith("export interface ")) {
      newLines.push(line);
      continue;
    }

    // Add await to db.insert/update/delete that are standalone statements (end with ;)
    // These are write operations that were .run() before
    if (/^\s*(db|tx)\.(insert|update|delete)\b/.test(line) && !line.includes("await")) {
      const indent = line.match(/^(\s*)/)?.[1] || "";
      line = line.replace(/^(\s*)(db|tx)\.(insert|update|delete)/, `${indent}await $2.$3`);
      changes++;
    }

    // Add await to assignments from db.select() chains
    // const x = db.select()... → const x = await db.select()...
    if (/^\s*(?:const|let|var)\s+(?:\[?\w+\]?|\w+)\s*=\s*(?:db|tx)\.select\b/.test(line) && !line.includes("await")) {
      line = line.replace(
        /^(\s*(?:const|let|var)\s+(?:\[?\w+\]?|\w+)\s*=\s*)(db|tx)(\.select\b)/,
        "$1await $2$3"
      );
      changes++;
    }

    // Add await to return db.select()... patterns
    if (/^\s*return\s+(?:db|tx)\.select\b/.test(line) && !line.includes("await")) {
      line = line.replace(/^(\s*return\s+)(db|tx)(\.select\b)/, "$1await $2$3");
      changes++;
    }

    // Add await to assignments from db.insert/update/delete chains that have .returning()
    if (/^\s*(?:const|let|var)\s+\w+\s*=\s*(?:db|tx)\.(insert|update|delete)\b/.test(line) && !line.includes("await")) {
      line = line.replace(
        /^(\s*(?:const|let|var)\s+\w+\s*=\s*)(db|tx)\.(insert|update|delete)\b/,
        "$1await $2.$3"
      );
      changes++;
    }

    // Handle: const x = (await db...)...[0] patterns where [0] was added from .get() removal
    // If we see "const x = db.select()..." with [0] at end, wrap in (await ...) pattern
    // Actually, the [0] replacement already happened, and if there's no await yet,
    // we need to handle the multiline case

    newLines.push(line);
  }

  content = newLines.join("\n");

  // ── Pass 5: Fix double-await ──
  content = content.replace(/await\s+await\s+/g, "await ");

  // ── Pass 6: Fix (await ...)[0] patterns where [0] was from .get() ──
  // When we replaced .get() with [0], multiline chains like:
  //   const row = db
  //     .select()
  //     .from(table)
  //     .where(...)
  //     [0];
  // need the await before db
  // These are harder to fix automatically — the type checker will catch them

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

for (const file of allFiles) {
  const rel = file.replace(ROOT + "/", "");
  const { changed, changes } = transformFile(file);
  if (changes > 0) {
    console.log(`${changed ? "✓" : "="} ${rel} (${changes} changes)`);
    if (changed) totalChanged++;
    totalChanges += changes;
  }
}

console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}${totalChanged} files modified, ${totalChanges} total changes`);
