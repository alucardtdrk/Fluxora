import type { GoogleWorkspaceClient } from "../client.js";
import { buildDirectoryPosture, type DirectoryPosture } from "../normalizers/directory.js";

interface DirectoryUser { readonly id: string; readonly primaryEmail?: string; readonly name?: { readonly fullName?: string }; readonly orgUnitPath?: string; readonly suspended: boolean; readonly isEnrolledIn2Sv: boolean }
interface Role { readonly roleId: string; readonly roleName: string }
interface RoleAssignment { readonly roleId: string; readonly assignedTo: string }

export interface CollectDirectoryPostureInput { readonly client: GoogleWorkspaceClient; readonly customerId: string; readonly domain: string; readonly capturedAt?: Date }

async function collectPages<T>(client: GoogleWorkspaceClient, url: URL): Promise<T[]> {
  const items: T[] = [];
  for await (const page of client.paginate<{ users?: readonly T[]; items?: readonly T[] }>(url)) items.push(...(page.users ?? page.items ?? []));
  return items;
}

export async function collectDirectoryPosture(input: CollectDirectoryPostureInput): Promise<DirectoryPosture> {
  const usersUrl = new URL("https://admin.googleapis.com/admin/directory/v1/users");
  usersUrl.searchParams.set("customer", input.customerId);
  usersUrl.searchParams.set("fields", "nextPageToken,users(id,primaryEmail,name(fullName),orgUnitPath,suspended,isEnrolledIn2Sv)");
  const rolesUrl = new URL(`https://admin.googleapis.com/admin/directory/v1/customer/${encodeURIComponent(input.customerId)}/roles`);
  rolesUrl.searchParams.set("fields", "nextPageToken,items(roleId,roleName)");
  const assignmentsUrl = new URL(`https://admin.googleapis.com/admin/directory/v1/customer/${encodeURIComponent(input.customerId)}/roleassignments`);
  assignmentsUrl.searchParams.set("fields", "nextPageToken,items(roleId,assignedTo)");
  const [users, roles, assignments] = await Promise.all([
    collectPages<DirectoryUser>(input.client, usersUrl), collectPages<Role>(input.client, rolesUrl), collectPages<RoleAssignment>(input.client, assignmentsUrl),
  ]);
  const roleNames = new Map(roles.map((role) => [role.roleId, role.roleName]));
  return buildDirectoryPosture({
    capturedAt: input.capturedAt ?? new Date(), domain: input.domain, complete: true,
    users: { active: users.filter((user) => !user.suspended).length, suspended: users.filter((user) => user.suspended).length, withoutTwoStepVerification: users.filter((user) => !user.isEnrolledIn2Sv).length },
    delegatedAdministrators: { totalAssignments: assignments.length, roleNames: [...new Set(assignments.map((assignment) => roleNames.get(assignment.roleId)).filter((name): name is string => Boolean(name)))].sort() },
    withoutTwoStepVerificationUsers: users.filter((user) => !user.isEnrolledIn2Sv).slice(0, 500).map((user) => ({ id: user.id, email: user.primaryEmail, displayName: user.name?.fullName, orgUnitPath: user.orgUnitPath, suspended: user.suspended, twoStepEnrolled: user.isEnrolledIn2Sv })),
    suspendedUsers: users.filter((user) => user.suspended).slice(0, 500).map((user) => ({ id: user.id, email: user.primaryEmail, displayName: user.name?.fullName, orgUnitPath: user.orgUnitPath, suspended: user.suspended, twoStepEnrolled: user.isEnrolledIn2Sv })),
  });
}
