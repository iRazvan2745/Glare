export type HealthStatus = "healthy" | "degraded" | "outage";

export type HealthInput = {
  totalWorkers: number;
  offlineWorkers: number;
  criticalWorkerOffline?: boolean;
  unlinkedRepositories?: number;
  errorRate24h: number;
  storageReachable?: boolean;
  recentPlanFailures?: number;
};

export const HEALTH_THRESHOLDS = {
  warningErrorRate: 1,
  criticalErrorRate: 5,
  warningPlanFailures: 1,
} as const;

export function deriveHealthStatus(input: HealthInput): HealthStatus {
  const {
    offlineWorkers,
    criticalWorkerOffline = false,
    unlinkedRepositories = 0,
    errorRate24h,
    storageReachable = true,
    recentPlanFailures = 0,
  } = input;

  if (
    criticalWorkerOffline ||
    !storageReachable ||
    errorRate24h >= HEALTH_THRESHOLDS.criticalErrorRate
  ) {
    return "outage";
  }

  if (
    offlineWorkers > 0 ||
    unlinkedRepositories > 0 ||
    errorRate24h >= HEALTH_THRESHOLDS.warningErrorRate ||
    recentPlanFailures >= HEALTH_THRESHOLDS.warningPlanFailures
  ) {
    return "degraded";
  }

  return "healthy";
}

export function statusToLabel(status: HealthStatus): string {
  if (status === "outage") return "Outage";
  if (status === "degraded") return "Degraded";
  return "Healthy";
}
