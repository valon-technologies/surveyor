export interface FeedbackBrief {
  id: string;
  created_at: string;
  status: "pending" | "resolved";
  source: "slack" | "linear" | "both";
  category: "bug" | "ux" | "data" | "feature" | "question";
  priority: "high" | "medium" | "low";
  confidence: number;
  summary: string;
  suggested_approach: string;
  relevant_files: string[];
  original_messages: {
    slack?: { ts: string; text: string; user: string; permalink?: string };
    linear?: { id: string; identifier: string; title: string; url: string };
  };
  resolved_at: string | null;
}

export interface AgentState {
  last_slack_ts: string | null;
  last_linear_sync: string | null;
  processed_linear_ids: string[];
}

export interface AgentConfig {
  slack_channel: string;
  linear_project: string;
  linear_project_id: string;
  poll_interval_minutes: number;
  triage_model: string;
  queue_dir: string;
  file_index_refresh_days: number;
}
