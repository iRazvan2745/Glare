"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";
import { toast } from "@/lib/toast";
import {
  RiAddLine,
  RiArrowLeftDoubleLine,
  RiArrowLeftSLine,
  RiArrowRightDoubleLine,
  RiArrowRightSLine,
  RiGroupLine,
  RiInformationLine,
  RiMoreLine,
  RiShieldLine,
  RiUserLine,
} from "@remixicon/react";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt?: string | Date | null;
};

type ListUsersResponse = {
  users: AdminUser[];
  total?: number;
};

const ROLE_OPTIONS = ["viewer", "member", "operator", "admin", "owner"] as const;
const ROWS_PER_PAGE_OPTIONS = [10, 20, 50] as const;

function normalizeRole(value: string | null | undefined) {
  const normalized = (value ?? "member").trim().toLowerCase();
  return normalized || "member";
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Request failed");
  }
  return "Request failed";
}

async function apiFetch(path: string, options?: RequestInit) {
  const base = env.NEXT_PUBLIC_SERVER_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<unknown>;
}

function StatusBadge({ banned }: { banned?: boolean | null }) {
  if (banned) {
    return (
      <Badge variant="destructive" size="sm">
        Banned
      </Badge>
    );
  }
  return (
    <Badge variant="success" size="sm">
      Active
    </Badge>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <RiShieldLine className="size-3.5 opacity-60" />
      <span className="capitalize">{role}</span>
    </span>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      await (
        authClient.admin.createUser as (input: {
          name: string;
          email: string;
          password: string;
          role: string;
        }) => Promise<unknown>
      )({ name: form.name, email: form.email, password: form.password, role: form.role });
      toast.success("User created");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "member" });
      onCreated();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <RiAddLine className="size-4" />
        Add User
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Add a new user account to the workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cu-name">Name</Label>
            <Input
              id="cu-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              minLength={1}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-email">Email</Label>
            <Input
              id="cu-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-password">Password</Label>
            <Input
              id="cu-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-role">Role</Label>
            <select
              id="cu-role"
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({ name: user.name ?? "", email: user.email ?? "" });

  useEffect(() => {
    if (open) setForm({ name: user.name ?? "", email: user.email ?? "" });
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: form.name, email: form.email }),
      });
      toast.success("User updated");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button className="w-full text-left" />}>Edit User</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Update name and email for {user.email}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="eu-name">Name</Label>
            <Input
              id="eu-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              minLength={1}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eu-email">Email</Label>
            <Input
              id="eu-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, onDeleted }: { user: AdminUser; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleDelete = async () => {
    setIsPending(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      toast.success("User deleted");
      setOpen(false);
      onDeleted();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button className="w-full text-left text-destructive-foreground" />}>
        Delete User
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
          <DialogDescription>
            Permanently delete <strong>{user.email}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive" disabled={isPending} onClick={() => void handleDelete()}>
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserActionsMenu({
  user,
  isMutating,
  onToggleBan,
  onRoleChange,
  onRefresh,
}: {
  user: AdminUser;
  isMutating: boolean;
  onToggleBan: () => void;
  onRoleChange: (role: string) => void;
  onRefresh: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={isMutating} />}>
        <RiMoreLine className="size-4" />
        <span className="sr-only">Actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <EditUserDialog user={user} onSaved={onRefresh} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Set Role</DropdownMenuLabel>
        {ROLE_OPTIONS.map((role) => (
          <DropdownMenuItem
            key={role}
            onClick={() => onRoleChange(role)}
            className={normalizeRole(user.role) === role ? "font-semibold" : ""}
          >
            <span className="capitalize">{role}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleBan}>
          {user.banned ? "Unban User" : "Ban User"}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive">
          <DeleteUserDialog user={user} onDeleted={onRefresh} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [mutatingUserId, setMutatingUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "banned">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  const loadUsers = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }

      try {
        const result = (await authClient.admin.listUsers({
          query: {
            limit: 200,
            searchField: "email",
            searchOperator: "contains",
            searchValue: query.trim() || undefined,
          },
        })) as unknown;

        const payload = ((result as { data?: unknown })?.data ?? result) as ListUsersResponse;
        setUsers(Array.isArray(payload?.users) ? payload.users : []);
      } catch (error) {
        toast.error(getErrorMessage(error));
        setUsers([]);
      } finally {
        setIsLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, roleFilter]);

  const totalUsers = users.length;
  const adminCount = useMemo(
    () => users.filter((u) => ["admin", "owner"].includes(normalizeRole(u.role))).length,
    [users],
  );
  const bannedCount = useMemo(() => users.filter((u) => Boolean(u.banned)).length, [users]);
  const activeCount = totalUsers - bannedCount;

  // Filter users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter === "active" && u.banned) return false;
      if (statusFilter === "banned" && !u.banned) return false;
      if (roleFilter !== "all" && normalizeRole(u.role) !== roleFilter) return false;
      return true;
    });
  }, [users, statusFilter, roleFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / rowsPerPage));
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredUsers.slice(start, start + rowsPerPage);
  }, [filteredUsers, page, rowsPerPage]);

  const allOnPageSelected =
    paginatedUsers.length > 0 && paginatedUsers.every((u) => selectedIds.has(u.id));
  const someOnPageSelected =
    paginatedUsers.some((u) => selectedIds.has(u.id)) && !allOnPageSelected;

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const u of paginatedUsers) next.delete(u.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const u of paginatedUsers) next.add(u.id);
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onRoleChange = async (userId: string, role: string) => {
    setMutatingUserId(userId);
    try {
      await (
        authClient.admin.setRole as (input: { userId: string; role: string }) => Promise<unknown>
      )({ userId, role });
      toast.success("Role updated");
      await loadUsers(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setMutatingUserId(null);
    }
  };

  const onToggleBan = async (user: AdminUser) => {
    setMutatingUserId(user.id);
    try {
      if (user.banned) {
        await (authClient.admin.unbanUser as (input: { userId: string }) => Promise<unknown>)({
          userId: user.id,
        });
        toast.success("User unbanned");
      } else {
        await (
          authClient.admin.banUser as (input: {
            userId: string;
            banReason?: string;
          }) => Promise<unknown>
        )({ userId: user.id, banReason: "Banned by workspace admin" });
        toast.success("User banned");
      }
      await loadUsers(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setMutatingUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Users</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">User List</h1>
        <CreateUserDialog onCreated={() => void loadUsers(true)} />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            <RiGroupLine className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users
            </CardTitle>
            <RiUserLine className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeCount}</p>
            <p className="text-xs text-muted-foreground">
              {totalUsers > 0 ? Math.round((activeCount / totalUsers) * 100) : 0}% of all users
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Admins</CardTitle>
            <RiShieldLine className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{adminCount}</p>
            <p className="text-xs text-muted-foreground">
              {totalUsers > 0 ? Math.round((adminCount / totalUsers) * 100) : 0}% of users
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Banned</CardTitle>
            <RiInformationLine className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{bannedCount}</p>
            <p className="text-xs text-muted-foreground">
              {totalUsers > 0 ? Math.round((bannedCount / totalUsers) * 100) : 0}% of users
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter users..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(val) => setStatusFilter(val as "all" | "active" | "banned")}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
          </SelectPopup>
        </Select>
        <Select value={roleFilter} onValueChange={(val) => setRoleFilter(val ?? "all")}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All Roles</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                <span className="capitalize">{r}</span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {isLoading ? "Loading users..." : "No users found."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedUsers.map((user) => {
                const isMutating = mutatingUserId === user.id;
                return (
                  <TableRow
                    key={user.id}
                    data-state={selectedIds.has(user.id) ? "selected" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(user.id)}
                        onCheckedChange={() => toggleSelect(user.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{user.name || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge banned={user.banned} />
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={normalizeRole(user.role)} />
                    </TableCell>
                    <TableCell>
                      <UserActionsMenu
                        user={user}
                        isMutating={isMutating}
                        onToggleBan={() => void onToggleBan(user)}
                        onRoleChange={(role) => void onRoleChange(user.id, role)}
                        onRefresh={() => void loadUsers(true)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination footer */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {selectedIds.size} of {filteredUsers.length} row(s) selected.
          </p>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select
                value={String(rowsPerPage)}
                onValueChange={(val) => {
                  setRowsPerPage(Number(val));
                  setPage(1);
                }}
              >
                <SelectTrigger size="sm" className="w-18">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {ROWS_PER_PAGE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                <RiArrowLeftDoubleLine className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <RiArrowLeftSLine className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <RiArrowRightSLine className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                <RiArrowRightDoubleLine className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
