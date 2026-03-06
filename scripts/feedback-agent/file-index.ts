import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "fs";
import { join, relative } from "path";

const SRC_ROOT = join(__dirname, "../../src");
const EXTENSIONS = [".ts", ".tsx"];

interface FileEntry {
  path: string;
  summary: string;
}

function getFirstComment(content: string): string {
  // Extract first JSDoc or // comment
  const jsdoc = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jsdoc) return jsdoc[1].replace(/\*\/.*/, "").trim();
  const line = content.match(/^\/\/\s*(.+)/m);
  if (line) return line[1].trim();
  // Fall back to first export name
  const exp = content.match(/export (?:default )?(?:function|const|class) (\w+)/);
  if (exp) return `exports ${exp[1]}`;
  return "";
}

function walkDir(dir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory() && !item.startsWith(".") && item !== "node_modules") {
      entries.push(...walkDir(full));
    } else if (EXTENSIONS.some((ext) => item.endsWith(ext))) {
      const content = readFileSync(full, "utf-8");
      const summary = getFirstComment(content);
      entries.push({ path: relative(SRC_ROOT, full), summary });
    }
  }
  return entries;
}

export function generateFileIndex(): FileEntry[] {
  return walkDir(SRC_ROOT);
}

export function fileIndexToString(entries: FileEntry[]): string {
  return entries
    .map((e) => `${e.path}${e.summary ? ` — ${e.summary}` : ""}`)
    .join("\n");
}

/** Generate and cache file index. Refreshes if older than `maxAgeDays`. */
export function getOrRefreshFileIndex(cacheDir: string, maxAgeDays: number): string {
  const cachePath = join(cacheDir, "file-index.txt");
  if (existsSync(cachePath)) {
    const stat = statSync(cachePath);
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < maxAgeDays) {
      return readFileSync(cachePath, "utf-8");
    }
  }
  const entries = generateFileIndex();
  const content = fileIndexToString(entries);
  writeFileSync(cachePath, content, "utf-8");
  return content;
}
