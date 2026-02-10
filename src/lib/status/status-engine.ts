import type { MappingStatus, WorkspaceTeam } from "@/lib/constants";

/**
 * On save: unmapped → pending, otherwise keep current.
 */
export function computeStatusOnSave(current: string): MappingStatus {
  if (current === "unmapped") return "pending";
  return current as MappingStatus;
}

/**
 * On comment: if the commenter has a team and mapping is not fully_closed,
 * transition to open_comment_{team}.
 */
export function computeStatusOnComment(
  current: string,
  team: WorkspaceTeam
): MappingStatus {
  if (current === "fully_closed") return "fully_closed";
  const statusMap: Record<WorkspaceTeam, MappingStatus> = {
    SM: "open_comment_sm",
    VT: "open_comment_vt",
  };
  return statusMap[team];
}
