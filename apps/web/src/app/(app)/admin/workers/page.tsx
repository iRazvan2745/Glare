"use client";

import {
  RiAddLine,
  RiLoader4Line,
  RiServerLine,
  RiWifiLine,
  RiWifiOffLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { ActionMenu, KpiStat } from "@/components/control-plane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

type WorkerRecord = {
  id: string;
  name: string;
  region: string | null;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  createdAt: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function AdminWorkersPage() {
  const { data: session } = authClient.useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createRegion, setCreateRegion] = useState("");

  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editRegion, setEditRegion] = useState("");

  const [newToken, setNewToken] = useState("");

  const loadWorkers = useCallback(async () => {
    if (!session?.user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await apiFetchJson<{ workers?: WorkerRecord[] }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers`,
        { method: "GET", retries: 1 },
      );
      setWorkers(data.workers ?? []);
    } catch {
      toast.error("Could not load workers.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    void loadWorkers();
  }, [loadWorkers]);

  async function createWorker() {
    if (!createName.trim()) return toast.error("Name is required");
    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ worker?: WorkerRecord; syncToken?: string }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers`,
        {
          method: "POST",
          body: JSON.stringify({
            name: createName.trim(),
            ...(createRegion.trim() ? { region: createRegion.trim() } : {}),
          }),
          retries: 1,
        },
      );
      if (data.worker) setWorkers((c) => [data.worker!, ...c]);
      setIsCreateOpen(false);
      setCreateName("");
      setCreateRegion("");
      if (data.syncToken) setNewToken(data.syncToken);
      toast.success("Worker created.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create worker.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(worker: WorkerRecord) {
    setEditingId(worker.id);
    setEditName(worker.name);
    setEditRegion(worker.region ?? "");
  }

  async function saveEdit() {
    if (!editName.trim()) return toast.error("Name is required");
    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ worker?: WorkerRecord }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: editName.trim(), region: editRegion.trim() || null }),
          retries: 1,
        },
      );
      if (data.worker)
        setWorkers((c) => c.map((w) => (w.id === data.worker!.id ? data.worker! : w)));
      setEditingId("");
      toast.success("Worker updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update worker.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteWorker(workerId: string) {
    setIsSaving(true);
    try {
      await apiFetchJson(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers/${workerId}`, {
        method: "DELETE",
        retries: 1,
      });
      setWorkers((c) => c.filter((w) => w.id !== workerId));
      toast.success("Worker deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete worker.");
    } finally {
      setIsSaving(false);
    }
  }

  async function rotateToken(workerId: string) {
    setIsSaving(true);
    try {
      const data = await apiFetchJson<{ syncToken?: string }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers/${workerId}/rotate-sync-token`,
        { method: "POST", retries: 1 },
      );
      if (data.syncToken) setNewToken(data.syncToken);
      toast.success("Sync token rotated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rotate token.");
    } finally {
      setIsSaving(false);
    }
  }

  const online = workers.filter((w) => w.isOnline).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Worker Fleet</h2>
          <p className="text-sm text-muted-foreground">
            Manage worker agents, sync tokens, and regions.
          </p>
        </div>
        {
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger render={<Button size="sm" className="gap-2" />}>
              <RiAddLine className="size-4" />
              New Worker
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Create Worker</DialogTitle>
                <DialogDescription>Register a new backup worker agent.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-1">
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    disabled={isSaving}
                    placeholder="my-worker"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>
                    Region <span className="text-xs text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={createRegion}
                    onChange={(e) => setCreateRegion(e.target.value)}
                    disabled={isSaving}
                    placeholder="eu-west-1"
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
                  Cancel
                </DialogClose>
                <Button disabled={isSaving} onClick={() => void createWorker()}>
                  {isSaving ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiStat label="Total workers" value={workers.length} icon={RiServerLine} color="blue" />
        <KpiStat label="Online" value={online} icon={RiWifiLine} color="green" />
        <KpiStat label="Offline" value={workers.length - online} icon={RiWifiOffLine} color="red" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
          <CardDescription>All registered worker agents in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead>Requests</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Loading workers...
                  </TableCell>
                </TableRow>
              ) : workers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No workers registered.
                  </TableCell>
                </TableRow>
              ) : (
                workers.map((worker) => (
                  <TableRow key={worker.id}>
                    <TableCell className="font-medium">{worker.name}</TableCell>
                    <TableCell className="text-muted-foreground">{worker.region ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={worker.isOnline ? "success" : "outline"}>
                        {worker.isOnline ? "Online" : worker.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(worker.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatUptime(worker.uptimeMs)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {worker.requestsTotal.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {worker.errorTotal.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(worker.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ActionMenu
                        items={[
                          { label: "Edit", onSelect: () => startEdit(worker) },
                          {
                            label: "Rotate sync token",
                            onSelect: () => void rotateToken(worker.id),
                          },
                          {
                            label: "Delete",
                            onSelect: () => void deleteWorker(worker.id),
                            destructive: true,
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={Boolean(editingId)} onOpenChange={(open) => !open && setEditingId("")}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>Update name and region.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-2">
              <Label>
                Region <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={editRegion}
                onChange={(e) => setEditRegion(e.target.value)}
                disabled={isSaving}
                placeholder="eu-west-1"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isSaving} />}>
              Cancel
            </DialogClose>
            <Button disabled={isSaving} onClick={() => void saveEdit()}>
              {isSaving ? <RiLoader4Line className="size-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync token reveal dialog */}
      <Dialog open={Boolean(newToken)} onOpenChange={(open) => !open && setNewToken("")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sync Token</DialogTitle>
            <DialogDescription>
              Copy this token now — it won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              readOnly
              value={newToken}
              className="font-mono text-xs"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(newToken);
                toast.success("Copied to clipboard.");
              }}
            >
              Copy
            </Button>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
