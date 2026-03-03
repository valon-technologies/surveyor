import configData from "@/data/onboarding-task-configs.json";

const data = configData as {
  taskToEntities: Record<string, string[]>;
  entityToTasks: Record<string, string[]>;
};

export function hasOnboardingConfig(entityName: string): boolean {
  return entityName in data.entityToTasks;
}

export function getOnboardingTasksForEntity(entityName: string): string[] {
  return data.entityToTasks[entityName] || [];
}

export function getAllOnboardedEntities(): string[] {
  return Object.keys(data.entityToTasks);
}
