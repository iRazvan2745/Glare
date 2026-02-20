"use client";

import {
  RiArrowDownSLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCloudLine,
  RiDatabase2Line,
  RiHardDrive2Line,
  RiLoader4Line,
  RiAddLine,
  RiServerLine,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetchJson } from "@/lib/api-fetch";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { formatBytes } from "@/lib/format-bytes";
import { authClient } from "@/lib/auth-client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/spinner";

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerRecord = {
  id: string;
  name: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
};

type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  repository: string;
  isInitialized: boolean;
  initializedAt: string | null;
  hasPassword: boolean;
  options: Record<string, string>;
  primaryWorker: WorkerRecord | null;
  backupWorkers: WorkerRecord[];
  worker?: WorkerRecord | null;
  createdAt: string;
  updatedAt: string;
};

type S3Draft = {
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  profile: string;
  storageClass: string;
  acl: string;
  pathStyle: boolean;
  disableTls: boolean;
  noVerifySsl: boolean;
};

type RepositoryFormData = {
  name: string;
  backend: string;
  repositoryPath: string;
  primaryWorkerId: string;
  backupWorkerIds: string[];
  password: string;
  optionsInput: string;
  s3: S3Draft;
};

type S3Preset = {
  id: string;
  label: string;
  description: string;
  values: Partial<S3Draft>;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKEND_OPTIONS = [
  { value: "s3", label: "Amazon S3 / S3-compatible", icon: RiCloudLine },
  { value: "local", label: "Local filesystem", icon: RiHardDrive2Line },
  { value: "b2", label: "Backblaze B2", icon: RiCloudLine },
  { value: "rest", label: "REST server", icon: RiServerLine },
  { value: "webdav", label: "WebDAV", icon: RiServerLine },
  { value: "sftp", label: "SFTP", icon: RiServerLine },
  { value: "rclone", label: "rclone", icon: RiDatabase2Line },
  { value: "other", label: "Other", icon: RiDatabase2Line },
] as const;

const S3_PRESETS: S3Preset[] = [
  {
    id: "aws",
    label: "AWS S3",
    description: "Standard AWS S3",
    values: {
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "minio",
    label: "MinIO",
    description: "Self-hosted MinIO",
    values: {
      endpoint: "http://127.0.0.1:9000",
      pathStyle: true,
      disableTls: true,
      noVerifySsl: false,
    },
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    description: "Account endpoint required",
    values: {
      endpoint: "https://<accountid>.r2.cloudflarestorage.com",
      region: "auto",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "b2",
    label: "Backblaze B2",
    description: "B2 S3-compatible",
    values: {
      endpoint: "https://s3.us-west-004.backblazeb2.com",
      region: "us-west-004",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "gov",
    label: "AWS GovCloud",
    description: "US GovCloud",
    values: {
      endpoint: "https://s3.us-gov-west-1.amazonaws.com",
      region: "us-gov-west-1",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDefaultS3Draft(): S3Draft {
  return {
    endpoint: "https://s3.amazonaws.com",
    bucket: "",
    prefix: "",
    region: "",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    profile: "",
    storageClass: "",
    acl: "",
    pathStyle: true,
    disableTls: false,
    noVerifySsl: false,
  };
}

function createDefaultFormData(): RepositoryFormData {
  return {
    name: "",
    backend: "s3",
    repositoryPath: "",
    primaryWorkerId: "",
    backupWorkerIds: [],
    password: "",
    optionsInput: "",
    s3: createDefaultS3Draft(),
  };
}

function formDataFromRepository(repo: RepositoryRecord): RepositoryFormData {
  const s3 = createDefaultS3Draft();
  const opts = repo.options;

  s3.endpoint = opts["s3.endpoint"] ?? s3.endpoint;
  s3.bucket = opts["s3.bucket"] ?? "";
  s3.prefix = opts["s3.prefix"] ?? "";
  s3.region = opts["s3.region"] ?? "";
  s3.accessKeyId = opts["s3.access-key-id"] ?? "";
  s3.secretAccessKey = opts["s3.secret-access-key"] ?? "";
  s3.sessionToken = opts["s3.session-token"] ?? "";
  s3.profile = opts["s3.profile"] ?? "";
  s3.storageClass = opts["s3.storage-class"] ?? "";
  s3.acl = opts["s3.acl"] ?? "";
  s3.pathStyle = opts["s3.path-style"] !== "false";
  s3.disableTls = opts["s3.disable-tls"] === "true";
  s3.noVerifySsl = opts["s3.no-verify-ssl"] === "true";

  return {
    name: repo.name,
    backend: repo.backend,
    repositoryPath: repo.repository,
    primaryWorkerId: repo.primaryWorker?.id ?? repo.worker?.id ?? "",
    backupWorkerIds: repo.backupWorkers.map((worker) => worker.id),
    password: "",
    optionsInput: Object.entries(opts)
      .filter(([key]) => !key.startsWith("s3."))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    s3,
  };
}

function buildS3Preview(s3: S3Draft) {
  const endpoint = (s3.endpoint.trim() || "https://s3.amazonaws.com").replace(/\/+$/, "");
  const bucket = s3.bucket.trim().replace(/^\/+|\/+$/g, "");
  const prefix = s3.prefix.trim().replace(/^\/+|\/+$/g, "");
  if (!bucket) return "s3:<endpoint>/<bucket>[/prefix]";
  return `s3:${endpoint}/${bucket}${prefix ? `/${prefix}` : ""}`;
}

function parseOptions(value: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || rest.length === 0) continue;
    options[key.trim()] = rest.join("=").trim();
  }
  return options;
}

function buildRequestBody(form: RepositoryFormData) {
  const isS3 = form.backend === "s3";
  return {
    name: form.name.trim(),
    backend: form.backend,
    repository: isS3 ? undefined : form.repositoryPath.trim(),
    primaryWorkerId: form.primaryWorkerId || undefined,
    backupWorkerIds: form.backupWorkerIds,
    // Temporary compatibility field while server keeps alias support.
    workerId: form.primaryWorkerId || undefined,
    password: form.password.trim() || undefined,
    options: parseOptions(form.optionsInput),
    s3: isS3
      ? {
          endpoint: form.s3.endpoint.trim() || undefined,
          bucket: form.s3.bucket.trim(),
          prefix: form.s3.prefix.trim() || undefined,
          region: form.s3.region.trim() || undefined,
          accessKeyId: form.s3.accessKeyId.trim() || undefined,
          secretAccessKey: form.s3.secretAccessKey.trim() || undefined,
          sessionToken: form.s3.sessionToken.trim() || undefined,
          profile: form.s3.profile.trim() || undefined,
          storageClass: form.s3.storageClass.trim() || undefined,
          acl: form.s3.acl.trim() || undefined,
          pathStyle: form.s3.pathStyle,
          disableTls: form.s3.disableTls,
          noVerifySsl: form.s3.noVerifySsl,
        }
      : undefined,
  };
}

function validateForm(form: RepositoryFormData): string | null {
  if (!form.name.trim()) return "Repository name is required.";
  if (form.backend === "s3" && !form.s3.bucket.trim()) return "S3 bucket is required.";
  if (form.backend !== "s3" && !form.repositoryPath.trim()) return "Repository path is required.";
  if (form.backend === "rclone") {
    const options = parseOptions(form.optionsInput);
    if (!options["rclone.type"] && !options["rclone.config.type"]) {
      return "rclone backend requires option rclone.type (example: rclone.type=s3).";
    }
  }
  return null;
}

// ─── S3 Configuration Form ──────────────────────────────────────────────────

function S3ConfigForm({
  s3,
  onChange,
  disabled,
}: {
  s3: S3Draft;
  onChange: (s3: S3Draft) => void;
  disabled?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const preview = useMemo(() => buildS3Preview(s3), [s3]);

  function update(patch: Partial<S3Draft>) {
    onChange({ ...s3, ...patch });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          S3 Configuration
        </Label>
      </div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        <TooltipProvider delay={200}>
          {S3_PRESETS.map((preset) => (
            <Tooltip key={preset.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={disabled}
                    onClick={() =>
                      update({
                        ...preset.values,
                        pathStyle: preset.values.pathStyle ?? true,
                      })
                    }
                  />
                }
              >
                {preset.label}
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{preset.description}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      <Separator />

      {/* Core S3 fields */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="s3-endpoint" className="text-xs">
            Endpoint
          </Label>
          <Input
            id="s3-endpoint"
            placeholder="https://s3.amazonaws.com"
            value={s3.endpoint}
            onChange={(e) => update({ endpoint: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s3-bucket" className="text-xs">
            Bucket <span className="text-destructive">*</span>
          </Label>
          <Input
            id="s3-bucket"
            placeholder="my-backup-bucket"
            value={s3.bucket}
            onChange={(e) => update({ bucket: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s3-prefix" className="text-xs">
            Prefix
          </Label>
          <Input
            id="s3-prefix"
            placeholder="backups/server-1"
            value={s3.prefix}
            onChange={(e) => update({ prefix: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s3-region" className="text-xs">
            Region
          </Label>
          <Input
            id="s3-region"
            placeholder="us-east-1"
            value={s3.region}
            onChange={(e) => update({ region: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <Separator />

      {/* Credentials */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s3-access-key" className="text-xs">
            Access Key ID
          </Label>
          <Input
            id="s3-access-key"
            placeholder="AKIA..."
            value={s3.accessKeyId}
            onChange={(e) => update({ accessKeyId: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s3-secret-key" className="text-xs">
            Secret Access Key
          </Label>
          <Input
            id="s3-secret-key"
            type="password"
            placeholder="Secret key"
            value={s3.secretAccessKey}
            onChange={(e) => update({ secretAccessKey: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Advanced settings — collapsed by default */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            />
          }
        >
          <RiArrowDownSLine
            className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
          Advanced options
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s3-session-token" className="text-xs">
                Session Token
              </Label>
              <Input
                id="s3-session-token"
                placeholder="Temporary session token"
                value={s3.sessionToken}
                onChange={(e) => update({ sessionToken: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s3-profile" className="text-xs">
                AWS Profile
              </Label>
              <Input
                id="s3-profile"
                placeholder="default"
                value={s3.profile}
                onChange={(e) => update({ profile: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s3-storage-class" className="text-xs">
                Storage Class
              </Label>
              <Input
                id="s3-storage-class"
                placeholder="STANDARD"
                value={s3.storageClass}
                onChange={(e) => update({ storageClass: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s3-acl" className="text-xs">
                ACL
              </Label>
              <Input
                id="s3-acl"
                placeholder="private"
                value={s3.acl}
                onChange={(e) => update({ acl: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id="s3-path-style"
                checked={s3.pathStyle}
                onCheckedChange={(checked) => update({ pathStyle: checked })}
                disabled={disabled}
              />
              <Label htmlFor="s3-path-style" className="text-xs">
                Path-style addressing
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="s3-disable-tls"
                checked={s3.disableTls}
                onCheckedChange={(checked) => update({ disableTls: checked })}
                disabled={disabled}
              />
              <Label htmlFor="s3-disable-tls" className="text-xs">
                Disable TLS
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="s3-no-verify-ssl"
                checked={s3.noVerifySsl}
                onCheckedChange={(checked) => update({ noVerifySsl: checked })}
                disabled={disabled}
              />
              <Label htmlFor="s3-no-verify-ssl" className="text-xs">
                Skip SSL verify
              </Label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Path preview */}
      <div className="rounded-md bg-muted px-3 py-1.5 font-mono wrap-break-word text-xs text-muted-foreground">
        {preview}
      </div>
    </div>
  );
}

// ─── Repository Form (shared between Create & Edit) ─────────────────────────

function RepositoryForm({
  form,
  onChange,
  workers,
  disabled,
  isEdit,
}: {
  form: RepositoryFormData;
  onChange: (form: RepositoryFormData) => void;
  workers: WorkerRecord[];
  disabled?: boolean;
  isEdit?: boolean;
}) {
  function update(patch: Partial<RepositoryFormData>) {
    onChange({ ...form, ...patch });
  }

  return (
    <div className="space-y-4 max-h-[62vh] overflow-y-auto pr-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">General</p>
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="repo-name" className="text-xs">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="repo-name"
          placeholder="production-backups"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          disabled={disabled}
        />
      </div>

      {/* Backend */}
      <div className="space-y-1.5">
        <Label className="text-xs">Backend</Label>
        <Select
          value={form.backend}
          onValueChange={(value) => update({ backend: value ?? form.backend })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select backend" />
          </SelectTrigger>
          <SelectContent>
            {BACKEND_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  <opt.icon className="size-3.5 text-muted-foreground" />
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backend</p>
      {/* S3 or generic path */}
      {form.backend === "s3" ? (
        <S3ConfigForm s3={form.s3} onChange={(s3) => update({ s3 })} disabled={disabled} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="repo-path" className="text-xs">
            Repository path <span className="text-destructive">*</span>
          </Label>
          <Input
            id="repo-path"
            placeholder={
              form.backend === "rclone"
                ? "bucket/path or rclone:<remote>:<path>"
                : "/mnt/backups/repo"
            }
            value={form.repositoryPath}
            onChange={(e) => update({ repositoryPath: e.target.value })}
            disabled={disabled}
          />
        </div>
      )}

      <Separator />

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Worker Linkage
      </p>
      {/* Worker assignment */}
      <div className="space-y-1.5">
        <Label className="text-xs">Primary worker (init/snapshots)</Label>
        <Select
          value={form.primaryWorkerId || "__none__"}
          onValueChange={(value) =>
            update({
              primaryWorkerId: !value || value === "__none__" ? "" : value,
            })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="No worker attached" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              <span className="text-muted-foreground">No worker attached</span>
            </SelectItem>
            {workers.map((worker) => (
              <SelectItem key={worker.id} value={worker.id}>
                <span className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${worker.isOnline ? "bg-emerald-500" : "bg-zinc-400"}`}
                  />
                  {worker.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Backup workers (plan execution)</Label>
        {workers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No workers available.</p>
        ) : (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border p-2">
            {workers.map((worker) => {
              const checked = form.backupWorkerIds.includes(worker.id);
              return (
                <label key={worker.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) =>
                      update({
                        backupWorkerIds: event.target.checked
                          ? [...form.backupWorkerIds, worker.id]
                          : form.backupWorkerIds.filter((id) => id !== worker.id),
                      })
                    }
                  />
                  <span
                    className={`size-1.5 rounded-full ${worker.isOnline ? "bg-emerald-500" : "bg-zinc-400"}`}
                  />
                  {worker.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Credentials
      </p>
      {/* Password */}
      <div className="space-y-1.5">
        <Label htmlFor="repo-password" className="text-xs">
          Password{isEdit ? " (leave blank to keep current)" : ""}
        </Label>
        <Input
          id="repo-password"
          type="password"
          placeholder={isEdit ? "Set new password" : "Repository password"}
          value={form.password}
          onChange={(e) => update({ password: e.target.value })}
          disabled={disabled}
        />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Advanced
      </p>
      {/* Extra options */}
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            />
          }
        >
          <RiArrowDownSLine className="size-3.5" />
          Extra options
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Textarea
            className="min-h-20 font-mono text-xs"
            placeholder={
              form.backend === "rclone"
                ? "One key=value per line:\nrclone.type=s3\nrclone.config.provider=Cloudflare\nrclone.config.access_key_id=...\nrclone.config.secret_access_key=...\nrclone.config.region=auto"
                : "One key=value per line:\nretries=5\ntimeout=30s"
            }
            value={form.optionsInput}
            onChange={(e) => update({ optionsInput: e.target.value })}
            disabled={disabled}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── Repository List Item ────────────────────────────────────────────────────

function RepositoryListItem({
  repo,
  onInit,
  onView,
  onEdit,
  onDelete,
  isInitializing,
  storageBytes,
}: {
  repo: RepositoryRecord;
  onInit: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isInitializing: boolean;
  storageBytes: number | null;
}) {
  const BackendIcon =
    BACKEND_OPTIONS.find((b) => b.value === repo.backend)?.icon ?? RiDatabase2Line;
  const health = deriveHealthStatus({
    totalWorkers: Math.max(1, repo.backupWorkers.length),
    offlineWorkers: repo.primaryWorker && !repo.primaryWorker.isOnline ? 1 : 0,
    unlinkedRepositories: repo.primaryWorker ? 0 : 1,
    errorRate24h: repo.isInitialized ? 0 : 1,
  });
  return (
    <div className="group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
        <BackendIcon className="size-6 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={`/repositories/${repo.id}`}
            className="truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {repo.name}
          </a>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {repo.backend}
          </Badge>
          <StatusBadge
            status={health}
            label={repo.isInitialized ? "Initialized" : "Uninitialized"}
          />
          {repo.hasPassword && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              encrypted
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{repo.repository || "—"}</p>
        <div className="mt-1 flex items-center gap-2">
          {repo.primaryWorker ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${repo.primaryWorker.isOnline ? "bg-emerald-500" : "bg-zinc-400"}`}
              />
              Primary: {repo.primaryWorker.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60">No primary worker</span>
          )}
          <span className="text-xs text-muted-foreground/80">
            Backup workers: {repo.backupWorkers.length}
          </span>
          <span className="text-xs text-muted-foreground/80">Recovery points: —</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TooltipProvider delay={200}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={onInit}
                  disabled={!repo.primaryWorker || repo.isInitialized || isInitializing}
                />
              }
            >
              {isInitializing ? (
                <span className="inline-flex items-center gap-1">
                  <RiLoader4Line className="size-3.5 animate-spin" />
                  Initializing
                </span>
              ) : repo.isInitialized ? (
                storageBytes != null ? (
                  formatBytes(storageBytes)
                ) : (
                  <Spinner />
                )
              ) : (
                "Init"
              )}
            </TooltipTrigger>
            <TooltipContent>
              {!repo.primaryWorker
                ? "Attach a primary worker before initializing"
                : repo.isInitialized
                  ? "This repository is already initialized"
                  : "Initialize this repository via its primary worker"}
            </TooltipContent>
          </Tooltip>
          <ActionMenu
            items={[
              { label: "Edit", onSelect: onEdit },
              { label: "Initialize", onSelect: onInit },
              { label: "View Recovery Points", onSelect: onView },
              { label: "Delete", onSelect: onDelete, destructive: true },
            ]}
          />
        </TooltipProvider>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RepositoriesPage() {
  const { data: session } = authClient.useSession();
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initializingId, setInitializingId] = useState("");

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<RepositoryFormData>(createDefaultFormData);

  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState<RepositoryFormData>(createDefaultFormData);

  const [deletingId, setDeletingId] = useState("");
  const deletingRepo = repositories.find((r) => r.id === deletingId);

  // Summary
  const summary = useMemo(() => {
    const byBackend: Record<string, number> = {};
    for (const opt of BACKEND_OPTIONS) byBackend[opt.value] = 0;
    for (const r of repositories) {
      byBackend[r.backend] = (byBackend[r.backend] ?? 0) + 1;
    }
    const linkedPrimary = repositories.filter((r) => r.primaryWorker !== null).length;
    const linkedBackup = repositories.filter((r) => r.backupWorkers.length > 0).length;
    return {
      total: repositories.length,
      linkedPrimary,
      linkedBackup,
      unlinked: repositories.length - linkedPrimary,
      byBackend,
    };
  }, [repositories]);

  // Fetch storage sizes for initialized repos
  const storageSizeQueries = useQueries({
    queries: repositories
      .filter((r) => r.isInitialized && r.options["s3.bucket"])
      .map((r) => {
        const remote = `glare-${r.id.split("-")[0]}:${r.options["s3.bucket"]}`;
        return {
          queryKey: ["repo-storage", r.id],
          queryFn: () =>
            apiFetchJson<{ rclone?: { parsedJson?: { bytes?: number } | null } }>(
              `/api/rustic/repository-size?remote=${encodeURIComponent(remote)}`,
            ).then((data) => data?.rclone?.parsedJson?.bytes ?? null),
          staleTime: 5 * 60 * 1000,
        };
      }),
  });

  const storageBytesById = useMemo(() => {
    const initialized = repositories.filter((r) => r.isInitialized && r.options["s3.bucket"]);
    return Object.fromEntries(
      initialized.map((r, i) => [r.id, storageSizeQueries[i]?.data ?? null]),
    );
  }, [repositories, storageSizeQueries]);

  // Data loading
  const loadData = useCallback(async () => {
    if (!session?.user) {
      setRepositories([]);
      setWorkers([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [repoData, workerData] = await Promise.all([
        apiFetchJson<{ repositories?: RepositoryRecord[] }>(
          `${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`,
          {
            method: "GET",
            retries: 1,
          },
        ),
        apiFetchJson<{ workers?: WorkerRecord[] }>(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
          method: "GET",
          retries: 1,
        }),
      ]);
      setRepositories(repoData.repositories ?? []);
      setWorkers(workerData.workers ?? []);
    } catch {
      toast.error("Could not load repository setup.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // CRUD
  async function handleCreate() {
    const error = validateForm(createForm);
    if (error) {
      toast.error(error);
      return;
    }
    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`,
        {
          method: "POST",
          body: JSON.stringify(buildRequestBody(createForm)),
          retries: 1,
        },
      );
      if (data.repository) {
        setRepositories((prev) => [data.repository!, ...prev]);
      }
      setCreateForm(createDefaultFormData());
      setIsCreateOpen(false);
      toast.success("Repository created.");
    } catch {
      toast.error("Could not create repository.");
    } finally {
      setIsSaving(false);
    }
  }

  function beginEdit(repo: RepositoryRecord) {
    setEditingId(repo.id);
    setEditForm(formDataFromRepository(repo));
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const error = validateForm(editForm);
    if (error) {
      toast.error(error);
      return;
    }
    setIsSaving(true);
    try {
      const body = buildRequestBody(editForm);
      // For edit, send workerId as null to unlink, and skip password if empty
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...body,
            primaryWorkerId: editForm.primaryWorkerId || null,
            backupWorkerIds: editForm.backupWorkerIds,
            workerId: editForm.primaryWorkerId || null,
            password: editForm.password.trim() || undefined,
          }),
          retries: 1,
        },
      );
      if (data.repository) {
        setRepositories((prev) =>
          prev.map((r) => (r.id === data.repository!.id ? data.repository! : r)),
        );
      }
      setEditingId("");
      toast.success("Repository updated.");
    } catch {
      toast.error("Could not update repository.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    setIsSaving(true);
    try {
      await apiFetchJson(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${deletingId}`, {
        method: "DELETE",
        retries: 1,
      });
      setRepositories((prev) => prev.filter((r) => r.id !== deletingId));
      setDeletingId("");
      toast.success("Repository deleted.");
    } catch {
      toast.error("Could not delete repository.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleInit(repo: RepositoryRecord) {
    if (!repo.primaryWorker) {
      toast.error("Attach a primary worker to this repository before initializing.");
      return;
    }
    if (repo.isInitialized) {
      toast.info("Repository is already initialized.");
      return;
    }

    setInitializingId(repo.id);
    try {
      await apiFetchJson(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repo.id}/init`, {
        method: "POST",
        retries: 1,
      });

      setRepositories((prev) =>
        prev.map((current) =>
          current.id === repo.id
            ? { ...current, isInitialized: true, initializedAt: new Date().toISOString() }
            : current,
        ),
      );
      toast.success(`Initialized ${repo.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not initialize repository.",
      );
    } finally {
      setInitializingId("");
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Repositories"
        subtitle="Repository inventory, initialization state, and worker assignment."
        actions={
          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) setCreateForm(createDefaultFormData());
            }}
          >
            <DialogTrigger render={<Button size="sm" className="gap-2" />}>
              <RiAddLine className="size-4" />
              New Repository
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Repository</DialogTitle>
                <DialogDescription>
                  Define backend, credentials, and worker linkage.
                </DialogDescription>
              </DialogHeader>
              <RepositoryForm
                form={createForm}
                onChange={setCreateForm}
                workers={workers}
                disabled={isSaving}
              />
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
                  Cancel
                </DialogClose>
                <Button onClick={() => void handleCreate()} disabled={isSaving}>
                  {isSaving ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStat label="Total" value={summary.total} icon={RiServerLine} color="blue" />
        <KpiStat
          label="Initialized"
          value={repositories.filter((repo) => repo.isInitialized).length}
          icon={RiCheckboxCircleLine}
          color="green"
        />
        <KpiStat
          label="Uninitialized"
          value={repositories.filter((repo) => !repo.isInitialized).length}
          icon={RiCloseCircleLine}
          color="amber"
        />
        <KpiStat
          label="Backends"
          value={Object.keys(summary.byBackend).length}
          icon={RiDatabase2Line}
          color="violet"
        />
      </div>

      {/* Repository list */}
      <Card>
        <CardHeader>
          <CardTitle>Repository Inventory</CardTitle>
          <CardDescription>{session?.user.email ?? "No active user"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading repositories...
            </p>
          )}
          {!isLoading && repositories.length === 0 && (
            <ControlPlaneEmptyState
              icon={RiDatabase2Line}
              title="No repositories configured"
              description="Create a repository to start collecting recovery points."
            />
          )}
          {!isLoading &&
            repositories.map((repo) => (
              <RepositoryListItem
                key={repo.id}
                repo={repo}
                onInit={() => void handleInit(repo)}
                onView={() => window.location.assign(`/repositories/${repo.id}`)}
                onEdit={() => beginEdit(repo)}
                onDelete={() => setDeletingId(repo.id)}
                isInitializing={initializingId === repo.id}
                storageBytes={storageBytesById[repo.id] ?? null}
              />
            ))}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={Boolean(editingId)} onOpenChange={(open) => !open && setEditingId("")}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Repository</DialogTitle>
            <DialogDescription>
              Update general settings, backend, credentials, and worker linkage.
            </DialogDescription>
          </DialogHeader>
          <RepositoryForm
            form={editForm}
            onChange={setEditForm}
            workers={workers}
            disabled={isSaving}
            isEdit
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
              Cancel
            </DialogClose>
            <Button onClick={() => void handleSaveEdit()} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(deletingId)} onOpenChange={(open) => !open && setDeletingId("")}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Repository</DialogTitle>
            <DialogDescription>
              {deletingRepo ? (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-foreground">{deletingRepo.name}</span>? This
                  cannot be undone.
                </>
              ) : (
                "This action cannot be undone."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={isSaving}>
              {isSaving ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
