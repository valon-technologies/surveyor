/**
 * Fix remaining async/await issues:
 * 1. Find functions containing 'await' that aren't 'async'
 * 2. Find [0] indexing on un-awaited db queries
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (["node_modules", ".next", "dist"].includes(entry)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...findTsFiles(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) results.push(full);
  }
  return results;
}

interface FuncInfo {
  lineIndex: number;
  isAsync: boolean;
  openBrace: number; // column of the opening {
}

function transformFile(filePath: string): boolean {
  const original = readFileSync(filePath, "utf8");
  const lines = original.split("\n");
  let changed = false;

  // Strategy: Use a brace-matching stack to track function scopes.
  // When we find 'await' in a non-async function, make it async.

  // Simple approach: find all lines with 'await', trace back to function definition
  const funcStack: FuncInfo[] = [];
  const needsAsync = new Set<number>(); // line indices that need 'async' added

  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip string content and comments roughly
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Track braces
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === "{") {
        braceDepth++;
        // Check if this opens a function
        // Look at the current line up to this point for function patterns
        const prefix = line.substring(0, c);
        const isFuncDef =
          /=>\s*$/.test(prefix) ||  // arrow function
          /\bfunction\b/.test(prefix) || // function keyword
          /\b(?:async\s+)?(?:\w+\s*)?\([^)]*\)\s*(?::\s*[^{]*)?$/.test(prefix); // method

        if (isFuncDef) {
          funcStack.push({
            lineIndex: i,
            isAsync: /\basync\b/.test(prefix),
            openBrace: c,
          });
        }
      } else if (ch === "}") {
        braceDepth--;
        if (funcStack.length > 0 && braceDepth <= funcStack[funcStack.length - 1].openBrace) {
          funcStack.pop();
        }
      }
    }

    // Check if this line has 'await'
    if (/\bawait\b/.test(line) && !trimmed.startsWith("//")) {
      // Find the innermost containing function
      if (funcStack.length > 0) {
        const func = funcStack[funcStack.length - 1];
        if (!func.isAsync) {
          needsAsync.add(func.lineIndex);
          func.isAsync = true; // Mark so we don't add twice
        }
      }
    }
  }

  // Apply async additions
  for (const lineIdx of needsAsync) {
    const line = lines[lineIdx];
    if (/\basync\b/.test(line)) continue; // Already async

    // Add 'async' before the function/arrow
    if (line.includes("=>")) {
      // Arrow function: find the start of params
      // Pattern: (params) => { or param => {
      lines[lineIdx] = line.replace(/(\([^)]*\)\s*=>)/, "async $1");
      if (lines[lineIdx] === line) {
        // Try simple arrow: x => {
        lines[lineIdx] = line.replace(/(\w+\s*=>)/, "async $1");
      }
      changed = true;
    } else if (line.includes("function")) {
      lines[lineIdx] = line.replace(/\bfunction\b/, "async function");
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(filePath, lines.join("\n"));
  }

  return changed;
}

const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/lib")];
let totalFixed = 0;

for (const dir of dirs) {
  for (const file of findTsFiles(dir)) {
    if (file.includes("codemod") || file.includes("schema.ts") || file.includes("seed.ts")) continue;
    if (transformFile(file)) totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
