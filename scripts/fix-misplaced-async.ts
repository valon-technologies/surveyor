/**
 * Fix misplaced 'async' keywords that were erroneously added by the codemod.
 * e.g., 'async if (...)' → 'if (...)'
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

const keywords = [
  "if", "for", "switch", "return", "const", "let", "var", "try", "throw",
  "while", "break", "continue", "else", "case", "default", "do", "new",
  "delete", "typeof", "void", "yield", "class", "export", "import",
  "this", "super", "null", "true", "false", "undefined",
];

const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/lib")];
let totalFixed = 0;

for (const dir of dirs) {
  for (const file of findTsFiles(dir)) {
    const original = readFileSync(file, "utf8");
    let content = original;

    for (const kw of keywords) {
      const regex = new RegExp(`\\basync\\s+(${kw}\\b)`, "g");
      content = content.replace(regex, "$1");
    }

    // Fix 'async {' (standalone async before a block)
    content = content.replace(/\basync\s+\{/g, "{");

    // Fix 'withTransactionasync' (from broken codemod)
    content = content.replace(/withTransactionasync/g, "withTransaction");
    content = content.replace(/with Transactionasync/g, "withTransaction");

    // Fix 'async async' (doubled)
    content = content.replace(/\basync\s+async\b/g, "async");

    if (content !== original) {
      writeFileSync(file, content);
      totalFixed++;
    }
  }
}

console.log(`Fixed ${totalFixed} files`);
