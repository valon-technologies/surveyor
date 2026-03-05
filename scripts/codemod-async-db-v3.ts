/**
 * Codemod v3: Fix remaining issues from v1/v2.
 *
 * 1. Add `await` before multiline db chains that weren't caught
 * 2. Make functions containing `await` into `async` functions
 *
 * Usage: npx tsx scripts/codemod-async-db-v3.ts [--dry-run]
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

  if (filePath.includes("schema.ts") && filePath.includes("db/")) return { changed: false, changes: 0 };
  if (filePath.includes("codemod-async-db")) return { changed: false, changes: 0 };
  if (filePath.includes("migrate-sqlite")) return { changed: false, changes: 0 };
  if (filePath.includes("seed.ts") && filePath.includes("db/")) return { changed: false, changes: 0 };

  // ── Fix 1: Add await to multiline db chains ──
  // Pattern: const x = db\n  .select()...
  // or: const x = db\n    .select()...
  // These weren't caught because `db` wasn't at the start of the assignment line

  // Find all "= db\n" or "= tx\n" that don't have await before db/tx
  content = content.replace(
    /^(\s*(?:const|let|var)\s+(?:\[?\w+(?:\s*,\s*\w+)*\]?)\s*=\s*)(?!await\s)(db|tx)\s*$/gm,
    (match, prefix, dbVar) => {
      changes++;
      return `${prefix}await ${dbVar}`;
    }
  );

  // Also: "return db\n" → "return await db\n"
  content = content.replace(
    /^(\s*return\s+)(?!await\s)(db|tx)\s*$/gm,
    (match, prefix, dbVar) => {
      changes++;
      return `${prefix}await ${dbVar}`;
    }
  );

  // ── Fix 2: Ensure functions containing await are async ──
  // Find function declarations/expressions that contain await but aren't async
  const lines = content.split("\n");

  // Track function boundaries using a simple stack
  // When we see a function/arrow that ISN'T async, and later find 'await' inside,
  // we need to add 'async'

  // Strategy: for each line with 'await', walk backwards to find its containing function
  // and ensure it's async

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("await ") && !line.includes("await(")) continue;
    // Skip comments
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

    // Walk backwards to find the containing function
    let braceDepth = 0;
    for (let j = i; j >= 0; j--) {
      const l = lines[j];
      // Count braces (simplified — doesn't handle strings/comments perfectly)
      for (const ch of l) {
        if (ch === "}") braceDepth++;
        if (ch === "{") braceDepth--;
      }

      if (braceDepth < 0) {
        // We've exited the current block — check if this line defines a function
        // Patterns:
        //   function name(...) {
        //   (...) => {
        //   async function name(...) {
        //   async (...) => {

        const funcLine = lines[j];

        // Already async — we're good
        if (/\basync\b/.test(funcLine)) break;

        // Arrow function: (...) => { or (x) => {
        if (/\)\s*=>\s*\{/.test(funcLine) || /\w+\s*=>\s*\{/.test(funcLine)) {
          // Add async before the arrow params
          // Find the start of the arrow expression
          const arrowMatch = funcLine.match(/^(.*?)(\([^)]*\)\s*=>\s*\{)/);
          if (arrowMatch) {
            lines[j] = funcLine.replace(
              arrowMatch[2],
              `async ${arrowMatch[2]}`
            );
            changes++;
          } else {
            // Simple arrow: x => {
            const simpleArrow = funcLine.match(/^(.*?)(\w+\s*=>\s*\{)/);
            if (simpleArrow) {
              lines[j] = funcLine.replace(simpleArrow[2], `async ${simpleArrow[2]}`);
              changes++;
            }
          }
          break;
        }

        // Regular function
        if (/\bfunction\s+\w+/.test(funcLine) || /\bfunction\s*\(/.test(funcLine)) {
          lines[j] = funcLine.replace(/\bfunction\b/, "async function");
          changes++;
          break;
        }

        // Method: name(...) {
        if (/^\s*\w+\s*\([^)]*\)\s*\{/.test(funcLine)) {
          const methodMatch = funcLine.match(/^(\s*)(\w+\s*\([^)]*\)\s*\{)/);
          if (methodMatch) {
            lines[j] = funcLine.replace(methodMatch[2], `async ${methodMatch[2]}`);
            changes++;
          }
          break;
        }

        break; // Don't search further back
      }
    }
  }

  content = lines.join("\n");

  // ── Fix 3: Clean up double-async ──
  content = content.replace(/\basync\s+async\b/g, "async");
  content = content.replace(/\bawait\s+await\b/g, "await");

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
