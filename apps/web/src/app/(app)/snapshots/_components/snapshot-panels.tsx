"use client";

import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiDownloadCloud2Line,
  RiErrorWarningLine,
  RiFileLine,
  RiFileTextLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiLoader4Line,
  RiShieldLine,
} from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import { formatDurationMs, numberToSize } from "./snapshot-helpers";
import type {
  FileTreeNode,
  SnapshotActivity,
  SnapshotRecord,
  WorkerRecord,
} from "./snapshot-helpers";

// ─── TimelineEntry ────────────────────────────────────────────────────────────

function TimelineEntry({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="relative pl-6">
      <div className="absolute left-0 top-0.5 flex size-5 items-center justify-center rounded-full border bg-background">
        {icon}
      </div>
      <div className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />

      <button
        type="button"
        className="mb-1 flex items-center gap-2 text-xs"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-medium">{title}</span>
        {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
      </button>

      {isOpen && <div className="space-y-2 pb-2">{children}</div>}
    </div>
  );
}

// ─── DetailRow ────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[10px] font-medium leading-none text-muted-foreground">{label}</dt>
      <dd className="truncate text-[11px] leading-snug" title={value}>
        {value}
      </dd>
    </div>
  );
}

// ─── FileTreeView ─────────────────────────────────────────────────────────────

export function FileTreeView({
  nodes,
  openFileNodes,
  setOpenFileNodes,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  openFileNodes: Record<string, boolean>;
  setOpenFileNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isOpen = openFileNodes[node.path] ?? depth < 1;
        return (
          <div key={node.path}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover:bg-muted/60"
              style={{ paddingLeft: `${6 + depth * 16}px` }}
              onClick={() => {
                if (node.kind === "dir") {
                  setOpenFileNodes((current) => ({
                    ...current,
                    [node.path]: !isOpen,
                  }));
                }
              }}
            >
              {node.kind === "dir" ? (
                <>
                  <RiArrowRightSLine
                    className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  {isOpen ? (
                    <RiFolderOpenLine className="size-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <RiFolderLine className="size-3.5 shrink-0 text-amber-500" />
                  )}
                </>
              ) : (
                <>
                  <span className="inline-block w-3 shrink-0" />
                  {node.name.endsWith(".txt") || node.name.endsWith(".md") ? (
                    <RiFileTextLine className="size-3.5 shrink-0 text-sky-500" />
                  ) : (
                    <RiFileLine className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </>
              )}
              <span className="truncate">{node.name}</span>
              {node.sizeLabel && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {node.sizeLabel}
                </span>
              )}
            </button>
            {node.kind === "dir" && isOpen && node.children.length > 0 ? (
              <FileTreeView
                nodes={node.children}
                openFileNodes={openFileNodes}
                setOpenFileNodes={setOpenFileNodes}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── SnapshotActivityDetailPanel ─────────────────────────────────────────────

export function SnapshotActivityDetailPanel({ activity }: { activity: SnapshotActivity }) {
  const progress = Math.max(0, Math.min(100, activity.progressPercent ?? 0));
  const filesProgress =
    activity.filesDone !== null && activity.filesTotal !== null
      ? `${activity.filesDone.toLocaleString()} / ${activity.filesTotal.toLocaleString()}`
      : "—";
  const bytesProgress =
    activity.bytesDone !== null && activity.bytesTotal !== null
      ? `${numberToSize(activity.bytesDone)} / ${numberToSize(activity.bytesTotal)}`
      : "—";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {activity.planName ?? "Snapshot plan"}{" "}
          <span className="font-normal text-muted-foreground">
            ({activity.kind === "running" ? "In Progress" : "Pending"})
          </span>
        </h2>
        <Badge variant={activity.kind === "running" ? "default" : "outline"}>
          {activity.kind === "running" ? "Running" : "Pending"}
        </Badge>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            <DetailRow label="Worker" value={activity.workerName ?? "—"} />
            <DetailRow
              label="Started"
              value={activity.startedAt ? new Date(activity.startedAt).toLocaleString() : "—"}
            />
            <DetailRow
              label="Next Run"
              value={activity.nextRunAt ? new Date(activity.nextRunAt).toLocaleString() : "—"}
            />
            <DetailRow
              label="Elapsed"
              value={activity.elapsedMs !== null ? formatDurationMs(activity.elapsedMs) : "—"}
            />
            <DetailRow label="Phase" value={activity.phase ?? "—"} />
            <DetailRow label="Current Path" value={activity.currentPath ?? "—"} />
            <DetailRow label="Files" value={filesProgress} />
            <DetailRow label="Bytes" value={bytesProgress} />
            <DetailRow
              label="Last Update"
              value={activity.lastEventAt ? new Date(activity.lastEventAt).toLocaleString() : "—"}
            />
          </div>
          <DetailRow label="Current Task" value={activity.message || "Waiting for update..."} />
          {activity.kind === "running" ? (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {progress > 0 ? `${progress}%` : "Estimating progress..."}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── SnapshotDetailPanel ──────────────────────────────────────────────────────

export function SnapshotDetailPanel({
  snapshot,
  workers,
  runSummary,
  fileTree,
  isFilesLoading,
  fileBrowserHint,
  isRunningRepositoryCheck,
  isRunningRepositoryRepairIndex,
  onRunRepositoryCheck,
  onRunRepositoryRepairIndex,
  openFileNodes,
  setOpenFileNodes,
  onForget,
  diffSummary,
  onDiffWithPrevious,
  isDiffing,
  onRestore,
  isRestoring,
  onFetchDirs,
}: {
  snapshot: SnapshotRecord;
  workers: WorkerRecord[];
  runSummary: { runCount: number; successCount: number; failureCount: number } | null;
  fileTree: FileTreeNode[];
  isFilesLoading: boolean;
  fileBrowserHint: string | null;
  isRunningRepositoryCheck: boolean;
  isRunningRepositoryRepairIndex: boolean;
  onRunRepositoryCheck?: () => Promise<void> | void;
  onRunRepositoryRepairIndex?: () => Promise<void> | void;
  openFileNodes: Record<string, boolean>;
  setOpenFileNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onForget?: (snapshotId: string) => Promise<void> | void;
  diffSummary?: { added: number; removed: number; changed: number } | null;
  onDiffWithPrevious?: () => Promise<void> | void;
  isDiffing?: boolean;
  onRestore?: (target: string) => Promise<void> | void;
  isRestoring?: boolean;
  onFetchDirs?: (path: string) => Promise<string[]>;
}) {
  const [isForgetDialogOpen, setIsForgetDialogOpen] = useState(false);
  const [isForgetting, setIsForgetting] = useState(false);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [restoreDialogTarget, setRestoreDialogTarget] = useState("/tmp/glare-restore");
  const [dirSuggestions, setDirSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!isRestoreDialogOpen || !onFetchDirs) return;
    const input = restoreDialogTarget.trim();
    const lastSlash = input.lastIndexOf("/");
    const parentDir = lastSlash <= 0 ? "/" : input.slice(0, lastSlash);
    let cancelled = false;
    const timer = setTimeout(() => {
      void onFetchDirs(parentDir)
        .then((dirs) => {
          if (!cancelled) setDirSuggestions(dirs);
        })
        .catch(() => {
          if (!cancelled) setDirSuggestions([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [restoreDialogTarget, isRestoreDialogOpen, onFetchDirs]);

  const filteredSuggestions = useMemo(
    () =>
      dirSuggestions.filter(
        (dir) => dir.startsWith(restoreDialogTarget.trim()) && dir !== restoreDialogTarget.trim(),
      ),
    [dirSuggestions, restoreDialogTarget],
  );

  const formattedTime = snapshot.time
    ? new Date(snapshot.time).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : snapshot.shortId;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{formattedTime}</h2>
        {onForget && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={isRestoring}
              onClick={() => setIsRestoreDialogOpen(true)}
            >
              {isRestoring ? "Restoring..." : "Restore"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-destructive hover:text-destructive"
              disabled={isForgetting}
              onClick={() => setIsForgetDialogOpen(true)}
            >
              <RiDeleteBinLine className="mr-1.5 size-3.5" />
              Forget (Destructive)
            </Button>
            <AlertDialog open={isForgetDialogOpen} onOpenChange={setIsForgetDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Forget snapshot?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Snapshot {snapshot.id.slice(0, 8)} will be permanently removed from the
                    repository. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsForgetDialogOpen(false)}
                    disabled={isForgetting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isForgetting}
                    onClick={async () => {
                      setIsForgetting(true);
                      setIsForgetDialogOpen(false);
                      try {
                        await onForget(snapshot.id);
                      } finally {
                        setIsForgetting(false);
                      }
                    }}
                  >
                    {isForgetting ? "Forgetting..." : "Forget Snapshot"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Restore snapshot</DialogTitle>
                  <DialogDescription>
                    Choose or type a path to restore the snapshot files to.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Restore target path</p>
                  <Autocomplete
                    // @ts-ignore - base-ui autocomplete API mismatch
                    inputValue={restoreDialogTarget}
                    // @ts-ignore
                    onInputChange={(val: string) => setRestoreDialogTarget(val)}
                    // @ts-ignore
                    onValueChange={(val: string) => {
                      if (val) setRestoreDialogTarget(String(val));
                    }}
                  >
                    <AutocompleteInput
                      className="w-full font-mono"
                      placeholder="/tmp/glare-restore"
                    />
                    {filteredSuggestions.length > 0 && (
                      <AutocompletePopup>
                        <AutocompleteList>
                          {filteredSuggestions.map((path) => (
                            <AutocompleteItem key={path} value={path}>
                              <RiFolderLine className="mr-1.5 size-3.5 text-amber-500" />
                              {path}
                            </AutocompleteItem>
                          ))}
                        </AutocompleteList>
                      </AutocompletePopup>
                    )}
                  </Autocomplete>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsRestoreDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      void onRestore?.(restoreDialogTarget);
                      setIsRestoreDialogOpen(false);
                    }}
                  >
                    Restore
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Changed-data diff</p>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void onDiffWithPrevious?.()}
              disabled={isDiffing || !onDiffWithPrevious}
            >
              {isDiffing ? "Diffing..." : "Diff vs previous"}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {diffSummary
              ? `Added ${diffSummary.added}, removed ${diffSummary.removed}, changed ${diffSummary.changed}`
              : "Run diff to compare this snapshot against the previous recovery point."}
          </p>
        </div>
        <div className="relative space-y-3">
          {/* ── Snapshot operation ── */}
          <TimelineEntry
            icon={<RiShieldLine className="size-3.5 text-amber-500" />}
            title={`${formattedTime} - Snapshot`}
            subtitle={snapshot.durationLabel ? `in ${snapshot.durationLabel}` : undefined}
            defaultOpen
          >
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <RiArrowDownSLine className="size-3 transition-transform [[data-state=closed]>&]:rotate-[-90deg]" />
                Details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1.5 space-y-2 rounded-md border bg-muted/30 p-2.5">
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    <DetailRow label="Snapshot ID" value={snapshot.shortId} />
                    <DetailRow label="Rustic Version" value={snapshot.programVersion ?? "—"} />
                    <DetailRow label="Original ID" value={snapshot.originalId ?? "—"} />
                    <DetailRow label="Parent ID" value={snapshot.parentId ?? "—"} />
                    <DetailRow label="Tree ID" value={snapshot.treeId ?? "—"} />
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    <DetailRow
                      label="User and Host"
                      value={
                        snapshot.username || snapshot.hostname
                          ? `${snapshot.username ?? ""}@${snapshot.hostname ?? ""}`
                          : "—"
                      }
                    />
                    <DetailRow
                      label="Tags"
                      value={
                        snapshot.tags && snapshot.tags.length > 0 ? snapshot.tags.join(", ") : "—"
                      }
                    />
                  </div>
                  <Separator />
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    <DetailRow
                      label="Files Added"
                      value={snapshot.filesNew?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Files Changed"
                      value={snapshot.filesChanged?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Files Unmodified"
                      value={snapshot.filesUnmodified?.toLocaleString() ?? "—"}
                    />
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    <DetailRow label="Bytes Added" value={snapshot.dataBlobsAdded || "—"} />
                    <DetailRow
                      label="Total Bytes Processed"
                      value={snapshot.totalBytesProcessed || "—"}
                    />
                    <DetailRow
                      label="Total Files Processed"
                      value={snapshot.totalFilesProcessed?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Total Dirs Processed"
                      value={snapshot.totalDirsProcessed?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Tree Blobs"
                      value={snapshot.treeBlobs?.toLocaleString() ?? "—"}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Snapshot Browser */}
            <Collapsible defaultOpen className="mt-2">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <RiArrowDownSLine className="size-3 transition-transform [[data-state=closed]>&]:rotate-[-90deg]" />
                Snapshot Browser
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-md border bg-muted/30 p-2">
                  {fileBrowserHint && (
                    <Alert variant="warning" className="mb-2">
                      <RiErrorWarningLine className="size-4" />
                      <AlertTitle>Snapshot index issue detected</AlertTitle>
                      <AlertDescription>
                        {fileBrowserHint.split("\n").map((line) => (
                          <span key={line} className="block text-xs">
                            {line}
                          </span>
                        ))}
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            isRunningRepositoryCheck ||
                            isRunningRepositoryRepairIndex ||
                            !onRunRepositoryCheck
                          }
                          onClick={() => void onRunRepositoryCheck?.()}
                        >
                          {isRunningRepositoryCheck ? "Running check..." : "Run Check"}
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={
                            isRunningRepositoryCheck ||
                            isRunningRepositoryRepairIndex ||
                            !onRunRepositoryRepairIndex
                          }
                          onClick={() => void onRunRepositoryRepairIndex?.()}
                        >
                          {isRunningRepositoryRepairIndex ? "Repairing..." : "Repair Index"}
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}
                  {isFilesLoading ? (
                    <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                      <RiLoader4Line className="size-3.5 animate-spin" />
                      Loading files...
                    </div>
                  ) : fileTree.length === 0 ? (
                    <p className="py-4 text-xs text-muted-foreground">No files found.</p>
                  ) : (
                    <FileTreeView
                      nodes={fileTree}
                      openFileNodes={openFileNodes}
                      setOpenFileNodes={setOpenFileNodes}
                    />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </TimelineEntry>

          {/* ── Backup operation ── */}
          <TimelineEntry
            icon={<RiDownloadCloud2Line className="size-3.5 text-emerald-500" />}
            title={`${formattedTime} - Backup`}
            subtitle={snapshot.durationLabel ? `in ${snapshot.durationLabel}` : undefined}
          >
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <RiArrowRightSLine className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
                Backup Details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                  <DetailRow label="Paths" value={snapshot.paths.join(", ") || "—"} />
                  <DetailRow label="Size" value={snapshot.sizeLabel || "—"} />
                  <DetailRow label="Duration" value={snapshot.durationLabel || "—"} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </TimelineEntry>
        </div>
      </div>
    </div>
  );
}
