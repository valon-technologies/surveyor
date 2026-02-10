export interface BigQueryConfig {
  projectId: string;
  sourceDataset: string;
  targetDataset?: string;
}

export interface BigQueryCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface WorkspaceSettings {
  tokenLimit?: number;
  defaultProvider?: string;
  bigquery?: BigQueryConfig;
}
