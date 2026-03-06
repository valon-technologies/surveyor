import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { HarvestedClaim } from "./types";

const DATA_DIR = "scripts/harvest/data";

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadClaims(filename: string): HarvestedClaim[] {
  const path = `${DATA_DIR}/${filename}`;
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function saveClaims(filename: string, claims: HarvestedClaim[]): void {
  ensureDir();
  writeFileSync(`${DATA_DIR}/${filename}`, JSON.stringify(claims, null, 2));
  console.log(`Saved ${claims.length} claims to ${DATA_DIR}/${filename}`);
}

export function loadAllClaims(): HarvestedClaim[] {
  ensureDir();
  const files = ["slack-claims.json", "sheets-claims.json", "linear-claims.json"];
  return files.flatMap((f) => loadClaims(f));
}
