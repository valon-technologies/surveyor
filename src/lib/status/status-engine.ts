import type { MappingStatus } from "@/lib/constants";

/**
 * On save: unmapped → unreviewed, otherwise keep current.
 */
export function computeStatusOnSave(current: string): MappingStatus {
  if (current === "unmapped") return "unreviewed";
  return current as MappingStatus;
}
