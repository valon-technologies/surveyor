# User Profiles, Leaderboard & Domain Expertise

## Context

Surveyor has multiple reviewers working across 6 domains. We need to:
1. Show each user's mapping performance stats on their profile
2. Surface domain-specific expertise (who's good at what)
3. Clearly separate admin vs non-admin access (admin = owner role)

## What Already Exists

- **User model**: name, email, image, domain preferences (`user.domains`)
- **Roles**: owner/editor/viewer on `userWorkspace`, enforced via `withAuth()`
- **Profile page**: Settings page with name, email, role, domain toggles
- **Members page**: Invite, role/team management (owner-only)
- **Leaderboard**: Dashboard API returns mostMapped, mostQuestionsAnswered, mostBotCollaborations
- **Auto-distribute**: Domain-aware field assignment to editors

## Design

### 1. Profile Stats Dashboard

**Route:** `GET /api/workspaces/[workspaceId]/members/[userId]/stats`

**Access:** Users can view their own stats. Admins (owners) can view anyone's stats.

**Response:**
```typescript
interface UserStats {
  userId: string;
  name: string;
  totalReviewed: number;           // accepted + excluded mappings
  totalQuestionsAnswered: number;  // resolved questions
  totalChatSessions: number;       // chat sessions created

  // Per-domain breakdown
  domainStats: {
    domain: FieldDomain;
    reviewed: number;              // fields reviewed in this domain
    acceptanceRate: number;        // % that stayed accepted (not corrected by another reviewer)
  }[];

  // Strongest domains (top 2 by volume where acceptanceRate > 80%)
  strengths: FieldDomain[];

  // Rank among all editors in this workspace
  rank: number;                    // position in mostMapped leaderboard
}
```

**Acceptance rate calculation:**
- Numerator: mappings where `assigneeId = user` AND `status = "accepted"` AND `isLatest = true` (still the latest version — no one overwrote it)
- Denominator: all mappings where `assigneeId = user` AND status in (`accepted`, `excluded`)
- A mapping that was accepted but later corrected (new version created by someone else) counts against acceptance rate

**Domain resolution:** Same as auto-distribute: `field.domainTag ?? entity.domainTags[0] ?? null`, looked up via `ENTITY_DOMAIN_MAP` in constants.

### 2. Profile Stats UI

**Location:** New section on the existing Settings profile page (`/settings`)

Below the current "Domain Specialties" section, add:

```
┌─ Your Stats ──────────────────────────────────────┐
│  142 fields reviewed  ·  28 questions answered     │
│  Rank #2 of 8 editors                              │
│                                                     │
│  Domain Breakdown                                   │
│  ┌────────────────────┬──────┬─────────────┐       │
│  │ Domain             │ Count│ Acceptance % │       │
│  ├────────────────────┼──────┼─────────────┤       │
│  │ ★ Escrow           │   52 │ 94%          │       │
│  │ ★ Payments         │   38 │ 88%          │       │
│  │   Delinq. Recovery │   22 │ 76%          │       │
│  │   Servicing Infra  │   18 │ 82%          │       │
│  │   Delinq. Retention│   12 │ 91%          │       │
│  └────────────────────┴──────┴─────────────┘       │
│  ★ = strength (top domain by volume, >80% accept)  │
└─────────────────────────────────────────────────────┘
```

### 3. Enhanced Leaderboard

**Location:** Existing Dashboard > Progress Summary page

Add a "Top Reviewers by Domain" section below the current leaderboard:

```
┌─ Domain Leaders ──────────────────────────┐
│  Escrow:       Alice (52) · Bob (31)      │
│  Payments:     Bob (45) · Charlie (28)    │
│  Delinq. Rec:  Charlie (38) · Alice (22)  │
│  Serv. Infra:  Alice (28) · Dave (18)     │
│  ...                                       │
└────────────────────────────────────────────┘
```

**API:** Extend existing `GET /api/workspaces/[workspaceId]/dashboard` response with:
```typescript
domainLeaders: {
  domain: FieldDomain;
  leaders: { userId: string; name: string; count: number }[];  // top 3
}[]
```

### 4. Admin Nav Gating

**Change:** Hide the "Admin" sidebar link for non-owner users.

**File:** `src/components/layout/sidebar-nav.tsx`

Fetch the user's workspace role and conditionally render the Admin nav item. The role is already available in the session — just need to pass it through.

### 5. Admin Profile Viewing

**Route:** `/settings/members/[userId]` (new page)

When an admin clicks a member's name in the Members list, show that user's profile stats. Reuses the same `UserStats` API endpoint.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/app/api/workspaces/[workspaceId]/members/[userId]/stats/route.ts` | **New** — user stats API |
| `src/app/settings/page.tsx` | Add stats dashboard section |
| `src/app/api/workspaces/[workspaceId]/dashboard/route.ts` | Add domainLeaders to response |
| `src/components/layout/sidebar-nav.tsx` | Gate Admin link behind owner role |
| `src/types/dashboard.ts` | Add DomainLeader type |

## Verification

1. Open Settings — see your own stats with domain breakdown
2. Check Dashboard — domain leaders section shows top reviewers per domain
3. As non-admin, confirm Admin link is hidden in sidebar
4. As admin, view Members page and click a user to see their stats
