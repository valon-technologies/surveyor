/**
 * Final fix pass: repair withTransaction calls and other codemod artifacts.
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

const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/lib")];
let totalFixed = 0;

for (const dir of dirs) {
  for (const file of findTsFiles(dir)) {
    const original = readFileSync(file, "utf8");
    let content = original;

    // Fix: "withTransaction async (() => {" → "await withTransaction(async () => {"
    content = content.replace(
      /(\w+\s*=\s*)?withTransaction\s+async\s*\(\(\)\s*=>\s*\{/g,
      (match, assign) => {
        const prefix = assign ? assign : "";
        return `${prefix}await withTransaction(async () => {`;
      }
    );

    // Fix: "withTransaction (() => {" → "await withTransaction(async () => {"
    content = content.replace(
      /(\w+\s*=\s*)?withTransaction\s*\(\(\)\s*=>\s*\{/g,
      (match, assign) => {
        const prefix = assign ? assign : "";
        return `${prefix}await withTransaction(async () => {`;
      }
    );

    // Fix: ".mapasync async (" → ".map("
    content = content.replace(/\.mapasync\s+async\s*\(/g, ".map(");

    // Fix: ".mapasync (" → ".map("
    content = content.replace(/\.mapasync\s*\(/g, ".map(");

    // Fix: ".filterasync (" → ".filter("
    content = content.replace(/\.filterasync\s*\(/g, ".filter(");

    // Fix: ".forEachasync (" → ".forEach("
    content = content.replace(/\.forEachasync\s*\(/g, ".forEach(");

    // Fix: ".someasync (" → ".some("
    content = content.replace(/\.someasync\s*\(/g, ".some(");

    // Fix: ".findAsync (" → ".find("
    content = content.replace(/\.findasync\s*\(/g, ".find(");

    // Fix any remaining ".XYZasync" patterns
    content = content.replace(/\.(map|filter|forEach|some|find|reduce|every|flatMap)async\b/g, ".$1");

    if (content !== original) {
      writeFileSync(file, content);
      totalFixed++;
    }
  }
}

console.log(`Fixed ${totalFixed} files`);
