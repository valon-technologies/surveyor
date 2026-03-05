/**
 * Fix remaining .mapasync async, .filterasync async patterns
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

const methods = ["map", "filter", "forEach", "some", "find", "reduce", "every", "flatMap"];
const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/lib")];
let totalFixed = 0;

for (const dir of dirs) {
  for (const file of findTsFiles(dir)) {
    const original = readFileSync(file, "utf8");
    let content = original;

    for (const m of methods) {
      // .mapasync async (( → .map(async ( — preserve async for the callback
      content = content.replace(new RegExp(`\\.${m}async\\s+async\\s*\\(`, "g"), `.${m}(async (`);
      // .mapasync (( → .map(( — no async needed
      content = content.replace(new RegExp(`\\.${m}async\\s*\\(`, "g"), `.${m}(`);
    }

    if (content !== original) {
      writeFileSync(file, content);
      totalFixed++;
    }
  }
}

console.log(`Fixed ${totalFixed} files`);
