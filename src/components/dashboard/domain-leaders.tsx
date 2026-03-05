"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FIELD_DOMAIN_LABELS, FIELD_DOMAIN_COLORS, type FieldDomain } from "@/lib/constants";
import { Users } from "lucide-react";

interface DomainLeader {
  userId: string;
  name: string | null;
  count: number;
}

interface DomainLeaderEntry {
  domain: FieldDomain;
  leaders: DomainLeader[];
}

export function DomainLeaders({ data }: { data: DomainLeaderEntry[] }) {
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4 text-muted-foreground" />
          Top Reviewers by Domain
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((entry) => (
            <div key={entry.domain} className="flex items-center gap-3 text-sm">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: FIELD_DOMAIN_COLORS[entry.domain] }}
              />
              <span className="w-36 shrink-0 font-medium text-xs">
                {FIELD_DOMAIN_LABELS[entry.domain]}
              </span>
              <span className="flex-1 text-xs text-muted-foreground truncate">
                {entry.leaders.map((l, i) => (
                  <span key={l.userId}>
                    {i > 0 && <span className="mx-1">·</span>}
                    <span className="text-foreground">{l.name ?? "Unknown"}</span>
                    <span className="text-muted-foreground ml-0.5">({l.count})</span>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
