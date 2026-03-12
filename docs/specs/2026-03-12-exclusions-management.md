# MAP-892: Servicing Transfer VDS Exclusions

## Problem

Three exclusion UX issues affecting reviewers:

1. **No central exclusions view** — once excluded, entities/fields are hard to find and revert. Only discoverable via the "Show Excluded" toggle in each transfer's review queue.
2. **Mapping updates don't auto-unexclude** — if a reviewer goes to an excluded field's discuss page and submits a mapping, the field stays excluded.
3. **Submit & Next shows excluded fields** — after submitting a review, the next-field navigation doesn't skip excluded fields.

## Design

### 1. Exclusions Management Page

**Route:** `/transfers/exclusions`
**Nav:** Indented under "Servicing Transfers" in the sidebar

**Layout:**
- Summary stats bar: X entities excluded (Y fields), Z individual fields excluded
- Two sections: Excluded Entities, Excluded Fields

**Excluded Entities table:**
- Columns: Entity Name, Field Count, Restore button
- "Restore All" restores the entity (clears `transferExcluded`) AND sets all that entity's `status="excluded"` mappings to `"unreviewed"`
- Bulk restore via checkboxes

**Excluded Fields table:**
- Columns: Entity, Field, Source, Transform, Confidence, Exclude Reason, Restore button
- "Restore" sets `status` → `"unreviewed"`, clears `excludeReason`
- Bulk restore via checkboxes
- Search bar filters by entity or field name
- Only shows individually-excluded fields (not fields hidden by entity-level exclusion — those are covered by entity restore)

**API endpoints:**
- `GET /api/workspaces/{wsId}/exclusions` — returns excluded entities + excluded field mappings
- `POST /api/workspaces/{wsId}/exclusions/restore-entity` — body: `{ entityId }` — clears metadata + restores field statuses
- `POST /api/workspaces/{wsId}/exclusions/restore-fields` — body: `{ mappingIds: string[] }` — batch restore to unreviewed

### 2. Auto-Unexclude on Mapping Update

**Where:** The mapping update endpoint (PATCH on field mapping)

When a mapping update includes source or transform changes AND the current status is `"excluded"`, automatically set status to `"unreviewed"` and clear `excludeReason`.

Entity-level `transferExcluded` stays unchanged — entity exclusion is a bulk shortcut. Individual field overrides are independent.

### 3. Submit & Next Skips Excluded

**Where:** Discuss page sibling navigation (`discuss-client.tsx` line 273-276)

The `actionable` filter already excludes `status === "excluded"` fields (line 276). The bug may be:
- Entity-level `transferExcluded` fields not filtered (metadata not available in entity data response)
- Or the review queue's own next-mapping navigation (separate from discuss page siblings)

**Fix:** Ensure the entity data endpoint includes `transferExcluded` metadata, and the sibling filter checks it. Also check the review queue's navigation path.
