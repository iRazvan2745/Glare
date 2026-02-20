"use client";

import { apiBaseUrl } from "@/lib/api-base-url";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCalendarScheduleLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiFileListLine,
  RiLoader4Line,
} from "@remixicon/react";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";
import {
  ActionMenu,
  ControlPlaneEmptyState,
  KpiStat,
  SectionHeader,
  StatusBadge,
} from "@/components/control-plane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { deriveHealthStatus } from "@/lib/control-plane/health";

type WorkerRecord = {
  id: string;
  name: string;
  isOnline: boolean;
  status: string;
  lastSeenAt: string | null;
};

type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  primaryWorker: WorkerRecord | null;
  backupWorkers: WorkerRecord[];
};

type BackupPlan = {
  id: string;
  name: string;
  cron: string;
  workerIds: string[];
  paths: string[];
  workerPathRules: Record<string, string[]>;
  tags: string[];
  dryRun: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  pruneEnabled: boolean;
  keepLast: number | null;
  keepDaily: number | null;
  keepWeekly: number | null;
  keepMonthly: number | null;
  keepYearly: number | null;
  keepWithin: string | null;
  repository: {
    id: string;
    name: string;
    backend: string;
    worker: WorkerRecord | null;
  };
  workers: WorkerRecord[];
  createdAt: string;
  updatedAt: string;
};

type PlanFormState = {
  name: string;
  repositoryId: string;
  workerIds: string[];
  cron: string;
  pathsInput: string;
  tagsInput: string;
  dryRun: boolean;
  enabled: boolean;
  pruneEnabled: boolean;
  keepLast: string;
  keepDaily: string;
  keepWeekly: string;
  keepMonthly: string;
  keepYearly: string;
  keepWithin: string;
};

function defaultForm(): PlanFormState {
  return {
    name: "",
    repositoryId: "",
    workerIds: [],
    cron: "0 */6 * * *",
    pathsInput: "/home",
    tagsInput: "",
    dryRun: false,
    enabled: true,
    pruneEnabled: false,
    keepLast: "",
    keepDaily: "",
    keepWeekly: "",
    keepMonthly: "",
    keepYearly: "",
    keepWithin: "",
  };
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function buildPathScriptFromPlan(plan: BackupPlan) {
  const lines: string[] = [];

  for (const path of plan.paths) {
    lines.push(path);
  }

  const workerNameById = new Map(plan.workers.map((worker) => [worker.id, worker.name]));
  const sortedRules = Object.entries(plan.workerPathRules ?? {}).sort(([left], [right]) => {
    const leftName = workerNameById.get(left) ?? left;
    const rightName = workerNameById.get(right) ?? right;
    return leftName.localeCompare(rightName);
  });
  for (const [workerId, workerPaths] of sortedRules) {
    const workerLabel = workerNameById.get(workerId) ?? workerId;
    lines.push(`@${workerLabel}: ${workerPaths.join(", ")}`);
  }

  return lines.join("\n");
}

function parsePathScript(
  script: string,
  availableWorkers: WorkerRecord[],
  selectedWorkerIds: string[],
):
  | { ok: true; value: { paths: string[]; workerPathRules: Record<string, string[]> } }
  | { ok: false; error: string } {
  const selectedWorkerSet = new Set(selectedWorkerIds);
  const workerBySelector = new Map<string, WorkerRecord>();
  for (const worker of availableWorkers) {
    workerBySelector.set(worker.id.toLowerCase(), worker);
    workerBySelector.set(worker.name.trim().toLowerCase(), worker);
  }

  const globalPaths: string[] = [];
  const workerPathRules: Record<string, string[]> = {};
  const lines = script.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 2) {
        return { ok: false, error: `Invalid worker rule on line ${index + 1}. Use @worker: /path` };
      }
      const selector = line.slice(1, separatorIndex).trim().toLowerCase();
      const targetWorker = workerBySelector.get(selector);
      if (!targetWorker) {
        return {
          ok: false,
          error: `Unknown worker on line ${index + 1}: ${line.slice(1, separatorIndex).trim()}`,
        };
      }
      if (!selectedWorkerSet.has(targetWorker.id)) {
        return { ok: false, error: `Worker on line ${index + 1} is not selected in Workers` };
      }

      const rhs = line.slice(separatorIndex + 1).trim();
      if (!rhs) {
        return { ok: false, error: `Missing paths on line ${index + 1}` };
      }

      const parsedPaths = normalizePaths(rhs.split(","));
      if (parsedPaths.length === 0) {
        return { ok: false, error: `Missing paths on line ${index + 1}` };
      }
      workerPathRules[targetWorker.id] = normalizePaths([
        ...(workerPathRules[targetWorker.id] ?? []),
        ...parsedPaths,
      ]);
      continue;
    }

    globalPaths.push(line);
  }

  const paths = normalizePaths(globalPaths);
  if (paths.length === 0 && Object.keys(workerPathRules).length === 0) {
    return { ok: false, error: "At least one backup path is required" };
  }
  if (paths.length === 0) {
    const missingWorkerPath = selectedWorkerIds.find(
      (workerId) => !workerPathRules[workerId]?.length,
    );
    if (missingWorkerPath) {
      const workerName =
        availableWorkers.find((worker) => worker.id === missingWorkerPath)?.name ??
        missingWorkerPath;
      return {
        ok: false,
        error: `No path rule provided for selected worker "${workerName}"`,
      };
    }
  }

  return { ok: true, value: { paths, workerPathRules } };
}

function retentionPayload(form: PlanFormState) {
  const intOrNull = (value: string) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    pruneEnabled: form.pruneEnabled,
    keepLast: intOrNull(form.keepLast),
    keepDaily: intOrNull(form.keepDaily),
    keepWeekly: intOrNull(form.keepWeekly),
    keepMonthly: intOrNull(form.keepMonthly),
    keepYearly: intOrNull(form.keepYearly),
    keepWithin: form.keepWithin.trim() || null,
  };
}

function formatRetentionSummary(plan: BackupPlan) {
  if (!plan.pruneEnabled) return null;
  const parts: string[] = [];
  if (plan.keepLast != null) parts.push(`${plan.keepLast} last`);
  if (plan.keepDaily != null) parts.push(`${plan.keepDaily} daily`);
  if (plan.keepWeekly != null) parts.push(`${plan.keepWeekly} weekly`);
  if (plan.keepMonthly != null) parts.push(`${plan.keepMonthly} monthly`);
  if (plan.keepYearly != null) parts.push(`${plan.keepYearly} yearly`);
  if (plan.keepWithin) parts.push(`within ${plan.keepWithin}`);
  return parts.length > 0 ? parts.join(", ") : "Enabled (no rules set)";
}

function countPlanPaths(plan: BackupPlan) {
  const workerPaths = Object.values(plan.workerPathRules ?? {}).reduce(
    (sum, paths) => sum + paths.length,
    0,
  );
  return plan.paths.length + workerPaths;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) return "—";
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

function formFromPlan(plan: BackupPlan): PlanFormState {
  const workerIds =
    plan.workerIds.length > 0 ? plan.workerIds : plan.workers.map((worker) => worker.id);

  return {
    name: plan.name,
    repositoryId: plan.repository.id,
    workerIds,
    cron: plan.cron,
    pathsInput: buildPathScriptFromPlan(plan),
    tagsInput: plan.tags.join(", "),
    dryRun: plan.dryRun,
    enabled: plan.enabled,
    pruneEnabled: plan.pruneEnabled,
    keepLast: plan.keepLast != null ? String(plan.keepLast) : "",
    keepDaily: plan.keepDaily != null ? String(plan.keepDaily) : "",
    keepWeekly: plan.keepWeekly != null ? String(plan.keepWeekly) : "",
    keepMonthly: plan.keepMonthly != null ? String(plan.keepMonthly) : "",
    keepYearly: plan.keepYearly != null ? String(plan.keepYearly) : "",
    keepWithin: plan.keepWithin ?? "",
  };
}

export default function BackupPlansPage() {
  const { data: session } = authClient.useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [plans, setPlans] = useState<BackupPlan[]>([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<PlanFormState>(defaultForm);
  const [runningPlanId, setRunningPlanId] = useState("");
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);

  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState<PlanFormState>(defaultForm);

  const loadData = useCallback(async () => {
    if (!session?.user) {
      setRepositories([]);
      setPlans([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [repoData, planData] = await Promise.all([
        apiFetchJson<{ repositories?: RepositoryRecord[] }>(
          `${apiBaseUrl}/api/rustic/repositories`,
          {
            method: "GET",
            retries: 1,
          },
        ),
        apiFetchJson<{ plans?: BackupPlan[] }>(`${apiBaseUrl}/api/rustic/plans`, {
          method: "GET",
          retries: 1,
        }),
      ]);
      setRepositories(repoData.repositories ?? []);
      setPlans(planData.plans ?? []);
    } catch {
      toast.error("Could not load backup plans.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isCreateOpen) return;
    if (createForm.repositoryId && createForm.workerIds.length > 0) return;

    const repository = repositories.find((entry) => entry.backupWorkers.length > 0);
    if (!repository) return;

    setCreateForm((current) => ({
      ...current,
      repositoryId: current.repositoryId || repository.id,
      workerIds:
        current.workerIds.length > 0 ? current.workerIds : [repository.backupWorkers[0]!.id],
    }));
  }, [isCreateOpen, repositories, createForm.repositoryId, createForm.workerIds]);

  async function createPlan() {
    if (!createForm.name.trim()) return toast.error("Plan name is required");
    if (!createForm.repositoryId) return toast.error("Repository is required");
    if (createForm.workerIds.length === 0) return toast.error("Select at least one worker");
    if (!createForm.cron.trim()) return toast.error("Cron expression is required");
    const selectedRepository = repositories.find((entry) => entry.id === createForm.repositoryId);
    if (!selectedRepository) return toast.error("Repository is required");
    const parsedPathScript = parsePathScript(
      createForm.pathsInput,
      selectedRepository.backupWorkers,
      createForm.workerIds,
    );
    if (!parsedPathScript.ok) return toast.error(parsedPathScript.error);

    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ plan?: BackupPlan }>(`${apiBaseUrl}/api/rustic/plans`, {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          repositoryId: createForm.repositoryId,
          workerIds: createForm.workerIds,
          cron: createForm.cron.trim(),
          paths: parsedPathScript.value.paths,
          workerPathRules: parsedPathScript.value.workerPathRules,
          tags: parseTags(createForm.tagsInput),
          dryRun: createForm.dryRun,
          enabled: createForm.enabled,
          ...retentionPayload(createForm),
        }),
        retries: 1,
      });
      if (data.plan) setPlans((current) => [data.plan!, ...current]);

      setIsCreateOpen(false);
      setCreateForm(defaultForm());
      toast.success("Backup plan created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create plan.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(plan: BackupPlan) {
    setEditingId(plan.id);
    setEditForm(formFromPlan(plan));
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name.trim()) return toast.error("Plan name is required");
    if (!editForm.repositoryId) return toast.error("Repository is required");
    if (editForm.workerIds.length === 0) return toast.error("Select at least one worker");
    if (!editForm.cron.trim()) return toast.error("Cron expression is required");
    const selectedRepository = repositories.find((entry) => entry.id === editForm.repositoryId);
    if (!selectedRepository) return toast.error("Repository is required");
    const parsedPathScript = parsePathScript(
      editForm.pathsInput,
      selectedRepository.backupWorkers,
      editForm.workerIds,
    );
    if (!parsedPathScript.ok) return toast.error(parsedPathScript.error);

    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ plan?: BackupPlan }>(
        `${apiBaseUrl}/api/rustic/plans/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editForm.name.trim(),
            repositoryId: editForm.repositoryId,
            workerIds: editForm.workerIds,
            cron: editForm.cron.trim(),
            paths: parsedPathScript.value.paths,
            workerPathRules: parsedPathScript.value.workerPathRules,
            tags: parseTags(editForm.tagsInput),
            dryRun: editForm.dryRun,
            enabled: editForm.enabled,
            ...retentionPayload(editForm),
          }),
          retries: 1,
        },
      );
      if (data.plan) {
        setPlans((current) =>
          current.map((plan) => (plan.id === data.plan!.id ? data.plan! : plan)),
        );
      }
      setEditingId("");
      toast.success("Backup plan updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update plan.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removePlan(planId: string) {
    setIsSaving(true);
    try {
      await apiFetchJson(`${apiBaseUrl}/api/rustic/plans/${planId}`, {
        method: "DELETE",
        retries: 1,
      });
      setPlans((current) => current.filter((plan) => plan.id !== planId));
      toast.success("Backup plan deleted.");
    } catch {
      toast.error("Could not delete plan.");
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePlan(plan: BackupPlan) {
    try {
      const data = await apiFetchJson<{ plan?: BackupPlan }>(
        `${apiBaseUrl}/api/rustic/plans/${plan.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !plan.enabled }),
          retries: 1,
        },
      );
      if (data.plan) {
        setPlans((current) =>
          current.map((entry) => (entry.id === data.plan!.id ? data.plan! : entry)),
        );
      }
    } catch {
      toast.error("Could not toggle plan.");
    }
  }

  async function runPlanNow(plan: BackupPlan) {
    setRunningPlanId(plan.id);
    try {
      await apiFetchJson(`${apiBaseUrl}/api/rustic/plans/${plan.id}/run`, {
        method: "POST",
        retries: 1,
      });
      toast.success(`Triggered "${plan.name}".`);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not trigger plan.");
    } finally {
      setRunningPlanId("");
    }
  }

  async function runBulkAction(action: "trigger" | "pause" | "resume" | "delete") {
    if (selectedPlanIds.length === 0) {
      toast.error("Select at least one plan.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await apiFetchJson<{
        ok: number;
        failed: number;
        results: Array<{ planId: string; ok: boolean; message: string }>;
      }>(`${apiBaseUrl}/api/rustic/plans/bulk`, {
        method: "POST",
        body: JSON.stringify({ action, planIds: selectedPlanIds }),
        retries: 1,
      });

      toast.success(`${action}: ${result.ok} succeeded, ${result.failed} failed.`);
      setSelectedPlanIds([]);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk operation failed.");
    } finally {
      setIsSaving(false);
    }
  }

  const nextRunSoonest = plans
    .filter((plan) => Boolean(plan.nextRunAt))
    .map((plan) => new Date(plan.nextRunAt!).getTime())
    .sort((a, b) => a - b)[0];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Schedules & Retention"
        subtitle="Execution policy for snapshot cadence and retention windows."
        actions={
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger render={<Button size="sm" className="gap-2" />}>
              <RiAddLine className="size-4" />
              New Policy
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Create Schedule</DialogTitle>
                <DialogDescription>
                  Define repository, workers, cron cadence, and retention policy.
                </DialogDescription>
              </DialogHeader>
              <PlanForm
                form={createForm}
                setForm={setCreateForm}
                repositories={repositories}
                disabled={isSaving}
              />
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
                  Cancel
                </DialogClose>
                <Button disabled={isSaving} onClick={() => void createPlan()}>
                  {isSaving ? "Creating..." : "Create Policy"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStat label="Total policies" value={plans.length} icon={RiFileListLine} color="blue" />
        <KpiStat
          label="Enabled"
          value={plans.filter((plan) => plan.enabled).length}
          icon={RiCheckboxCircleLine}
          color="green"
        />
        <KpiStat
          label="Failed (last 7d)"
          value={plans.filter((plan) => plan.lastStatus === "failed").length}
          icon={RiCloseCircleLine}
          color="red"
        />
        <KpiStat
          label="Next run (soonest)"
          value={nextRunSoonest ? formatDistanceToNow(new Date(nextRunSoonest).toISOString()) : "—"}
          icon={RiCalendarScheduleLine}
          color="violet"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Retention Policies</CardTitle>
          <CardDescription>
            Scheduler evaluates cadence every 30 seconds and executes due policy runs.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              disabled={isSaving || selectedPlanIds.length === 0}
              onClick={() => void runBulkAction("trigger")}
            >
              Trigger Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSaving || selectedPlanIds.length === 0}
              onClick={() => void runBulkAction("pause")}
            >
              Pause Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSaving || selectedPlanIds.length === 0}
              onClick={() => void runBulkAction("resume")}
            >
              Resume Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isSaving || selectedPlanIds.length === 0}
              onClick={() => void runBulkAction("delete")}
            >
              Delete Selected
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading plans...</p>
          )}
          {!isLoading && plans.length === 0 && (
            <ControlPlaneEmptyState
              icon={RiCalendarScheduleLine}
              title="No retention policies configured"
              description="Create a schedule to enforce recovery point cadence and retention."
            />
          )}

          {!isLoading &&
            plans.map((plan) => (
              <div
                key={plan.id}
                className="group flex items-center gap-3 rounded-lg border px-4 py-3 hover:bg-muted/30"
              >
                <Checkbox
                  checked={selectedPlanIds.includes(plan.id)}
                  onCheckedChange={(checked) =>
                    setSelectedPlanIds((current) =>
                      checked
                        ? Array.from(new Set([...current, plan.id]))
                        : current.filter((id) => id !== plan.id),
                    )
                  }
                />
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <RiCalendarScheduleLine className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{plan.name}</p>
                    <StatusBadge
                      status={deriveHealthStatus({
                        totalWorkers: plan.workers.length,
                        offlineWorkers: plan.workers.filter((worker) => !worker.isOnline).length,
                        errorRate24h: plan.lastStatus === "failed" ? 5 : 0,
                        recentPlanFailures: plan.lastStatus === "failed" ? 1 : 0,
                      })}
                      label={plan.enabled ? "Enabled" : "Disabled"}
                    />
                    <Badge variant="outline">{plan.cron}</Badge>
                    {plan.dryRun ? <Badge variant="outline">Dry run</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {plan.repository.name} ({plan.repository.backend})
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Workers: {plan.workers.map((worker) => worker.name).join(", ") || "None"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {countPlanPaths(plan)} paths • Next: {formatDate(plan.nextRunAt)} • Last:{" "}
                    {formatDate(plan.lastRunAt)}
                    {formatRetentionSummary(plan)
                      ? ` • Retention: ${formatRetentionSummary(plan)}`
                      : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Last run duration: {formatDuration(plan.lastDurationMs)}
                  </p>
                  {plan.lastStatus === "failed" && plan.lastError ? (
                    <p className="truncate text-xs font-medium text-destructive">
                      Investigate failure: {plan.lastError}
                    </p>
                  ) : null}
                </div>
                <ActionMenu
                  items={[
                    {
                      label: runningPlanId === plan.id ? "Running..." : "Run now",
                      onSelect: () => void runPlanNow(plan),
                    },
                    {
                      label: plan.enabled ? "Disable" : "Enable",
                      onSelect: () => void togglePlan(plan),
                    },
                    { label: "Edit", onSelect: () => startEdit(plan) },
                    {
                      label: "Delete",
                      onSelect: () => void removePlan(plan.id),
                      destructive: true,
                    },
                  ]}
                />
              </div>
            ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingId)} onOpenChange={(open) => !open && setEditingId("")}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
            <DialogDescription>
              Update cadence, worker assignments, and retention constraints.
            </DialogDescription>
          </DialogHeader>
          <PlanForm
            form={editForm}
            setForm={setEditForm}
            repositories={repositories}
            disabled={isSaving}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
              Cancel
            </DialogClose>
            <Button disabled={isSaving} onClick={() => void saveEdit()}>
              {isSaving ? (
                <span className="inline-flex items-center gap-1.5">
                  <RiLoader4Line className="size-3.5 animate-spin" />
                  Saving
                </span>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanForm({
  form,
  setForm,
  repositories,
  disabled,
}: {
  form: PlanFormState;
  setForm: Dispatch<SetStateAction<PlanFormState>>;
  repositories: RepositoryRecord[];
  disabled: boolean;
}) {
  function update<K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const selectedRepository = repositories.find((entry) => entry.id === form.repositoryId) ?? null;
  const availableWorkers = selectedRepository?.backupWorkers ?? [];

  function toggleWorker(workerId: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...form.workerIds, workerId]))
      : form.workerIds.filter((entry) => entry !== workerId);
    update("workerIds", next);
  }

  return (
    <div className="grid gap-4 py-1">
      <div className="grid gap-2">
        <Label>Plan name</Label>
        <Input
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-2">
        <Label>Repository</Label>
        <Select
          value={form.repositoryId}
          onValueChange={(value) => {
            const repositoryId = value ?? "";
            const repository = repositories.find((entry) => entry.id === repositoryId) ?? null;
            const validWorkerIds = form.workerIds.filter((workerId) =>
              (repository?.backupWorkers ?? []).some((worker) => worker.id === workerId),
            );

            update("repositoryId", repositoryId);
            update(
              "workerIds",
              validWorkerIds.length > 0
                ? validWorkerIds
                : repository?.backupWorkers[0]
                  ? [repository.backupWorkers[0].id]
                  : [],
            );
          }}
        >
          <SelectTrigger disabled={disabled}>
            <SelectValue placeholder="Choose repository" />
          </SelectTrigger>
          <SelectContent>
            {repositories.map((repository) => (
              <SelectItem key={repository.id} value={repository.id}>
                {repository.name} ({repository.backend})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Workers</Label>
        <div className="space-y-2 rounded-md border p-3">
          {availableWorkers.length === 0 && (
            <p className="text-xs text-destructive">
              No backup workers attached to this repository. Attach workers in Repositories first.
            </p>
          )}
          {availableWorkers.map((worker) => {
            const id = `plan-worker-${worker.id}`;
            return (
              <div key={worker.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={form.workerIds.includes(worker.id)}
                  onCheckedChange={(checked) => toggleWorker(worker.id, checked === true)}
                  disabled={disabled}
                />
                <Label htmlFor={id} className="text-sm font-normal">
                  {worker.name}
                  <span className="ml-1 text-xs text-muted-foreground">({worker.status})</span>
                </Label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Cron schedule</Label>
        <Input
          value={form.cron}
          onChange={(event) => update("cron", event.target.value)}
          placeholder="0 */6 * * *"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Use 5-part cron format: minute hour day month weekday
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Paths Script</Label>
        <Textarea
          className="min-h-24 font-mono text-xs"
          value={form.pathsInput}
          onChange={(event) => update("pathsInput", event.target.value)}
          placeholder={`/home/common\n@local: /home/local, /srv/local\n@local-2: /home/worker2`}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Global paths: one path per line. Worker-specific paths:{" "}
          <code className="font-mono">@worker-name: /path/a, /path/b</code>
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Tags (comma-separated, optional)</Label>
        <Input
          value={form.tagsInput}
          onChange={(event) => update("tagsInput", event.target.value)}
          placeholder="nightly, critical"
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Enabled</p>
            <p className="text-xs text-muted-foreground">Scheduler can run this plan</p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) => update("enabled", checked)}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Dry run</p>
            <p className="text-xs text-muted-foreground">
              Run backup command without writing snapshots
            </p>
          </div>
          <Switch
            checked={form.dryRun}
            onCheckedChange={(checked) => update("dryRun", checked)}
            disabled={disabled}
          />
        </div>
      </div>

      <Collapsible defaultOpen={form.pruneEnabled}>
        <div className="rounded-md border">
          <CollapsibleTrigger className="flex w-full items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Retention Policy</p>
              {form.pruneEnabled && (
                <Badge variant="secondary" className="text-[10px]">
                  Active
                </Badge>
              )}
            </div>
            <RiArrowDownSLine className="size-4 text-muted-foreground transition-transform [[data-state=closed]>&]:rotate-[-90deg]" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t px-3 pb-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-prune after backup</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically prune old snapshots after each backup
                  </p>
                </div>
                <Switch
                  checked={form.pruneEnabled}
                  onCheckedChange={(checked) => update("pruneEnabled", checked)}
                  disabled={disabled}
                />
              </div>
              {form.pruneEnabled && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Last</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={form.keepLast}
                      onChange={(e) => update("keepLast", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Daily</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={form.keepDaily}
                      onChange={(e) => update("keepDaily", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Weekly</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={form.keepWeekly}
                      onChange={(e) => update("keepWeekly", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Monthly</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={form.keepMonthly}
                      onChange={(e) => update("keepMonthly", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Yearly</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={form.keepYearly}
                      onChange={(e) => update("keepYearly", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Keep Within</Label>
                    <Input
                      placeholder="30d"
                      value={form.keepWithin}
                      onChange={(e) => update("keepWithin", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
