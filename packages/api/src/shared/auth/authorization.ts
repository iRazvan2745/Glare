type UserWithRole = { id: string; role?: string | null } | null;

const ROLE_RANK = {
  viewer: 0,
  member: 1,
  operator: 1,
  admin: 2,
  owner: 3,
} as const;

type RoleName = keyof typeof ROLE_RANK;

function toRole(value: string | null | undefined): RoleName {
  if (value == null) return "member";
  const normalized = value.trim().toLowerCase();
  if (normalized === "viewer") return "viewer";
  if (normalized === "operator") return "operator";
  if (normalized === "admin") return "admin";
  if (normalized === "owner") return "owner";
  return "viewer";
}

export function hasRoleAtLeast(user: UserWithRole, required: RoleName) {
  if (!user) return false;
  const actualRole = toRole(user.role);
  return ROLE_RANK[actualRole] >= ROLE_RANK[required];
}
