"use client";

import { CheckCircle, HelpCircle, MessageSquare } from "lucide-react";
import { LeaderboardCard } from "./leaderboard-card";
import type { LeaderboardData } from "@/types/dashboard";

export function Leaderboard({ data }: { data: LeaderboardData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <LeaderboardCard
        title="Most Mapped"
        icon={CheckCircle}
        entries={data.mostMapped}
        emptyMessage="No accepted mappings yet"
      />
      <LeaderboardCard
        title="Questions Answered"
        icon={HelpCircle}
        entries={data.mostQuestionsAnswered}
        emptyMessage="No resolved questions yet"
      />
      <LeaderboardCard
        title="Bot Collaborations"
        icon={MessageSquare}
        entries={data.mostBotCollaborations}
        emptyMessage="No chat sessions yet"
      />
    </div>
  );
}
