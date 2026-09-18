export interface DirectoryPosture {
  readonly id: "current";
  readonly capturedAt: Date;
  readonly domain: string;
  readonly complete: boolean;
  readonly users: { readonly active: number; readonly suspended: number; readonly withoutTwoStepVerification: number };
  readonly delegatedAdministrators: { readonly totalAssignments: number; readonly roleNames: readonly string[] };
  readonly withoutTwoStepVerificationUsers?: readonly DirectoryPostureUser[];
  readonly suspendedUsers?: readonly DirectoryPostureUser[];
}

export interface DirectoryPostureUser {
  readonly id: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly orgUnitPath?: string;
  readonly suspended: boolean;
  readonly twoStepEnrolled: boolean;
}

export function buildDirectoryPosture(input: Omit<DirectoryPosture, "id">): DirectoryPosture {
  return { id: "current", ...input };
}
