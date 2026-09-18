export const WORKSPACE_BACKFILL_DAYS = 90;
export const WORKSPACE_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface BackfillWindowInput {
  readonly targetStart: Date;
  readonly targetEnd: Date;
  readonly coveredThrough?: Date;
  readonly windowMs?: number;
}

export interface BackfillWindow {
  readonly start: Date;
  readonly end: Date;
  readonly complete: boolean;
}

export function planWorkspaceBackfillWindow(input: BackfillWindowInput): BackfillWindow {
  const start = new Date((input.coveredThrough ?? input.targetStart).getTime());
  const targetEnd = input.targetEnd.getTime();
  const end = new Date(Math.min(start.getTime() + (input.windowMs ?? WORKSPACE_BACKFILL_WINDOW_MS), targetEnd));
  return { start, end, complete: end.getTime() >= targetEnd };
}
