import configData from "@/data/onboarding-task-configs.json";

export interface OnboardingTaskInfo {
  taskType: string;
  role: "primary" | "dependency";
  consumedFields: string[];
}

const data = configData as {
  taskDetails: Record<string, {
    entities: string[];
    entityRoles: Record<string, string>;
    consumedFields: string[];
  }>;
  entityToTasks: Record<string, OnboardingTaskInfo[]>;
};

export function hasOnboardingConfig(entityName: string): boolean {
  return entityName in data.entityToTasks;
}

export function getOnboardingTasksForEntity(entityName: string): string[] {
  return (data.entityToTasks[entityName] || []).map((t) => t.taskType);
}

export function getOnboardingDetailForEntity(entityName: string): OnboardingTaskInfo[] {
  return data.entityToTasks[entityName] || [];
}

export function getAllOnboardedEntities(): string[] {
  return Object.keys(data.entityToTasks);
}
