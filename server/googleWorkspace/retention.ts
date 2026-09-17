export async function removeExpiredWorkspaceEvents(input: { listExpired(): Promise<readonly string[]>; deleteEvent(id: string): Promise<void> }): Promise<number> {
  const ids = (await input.listExpired()).slice(0, 200);
  await Promise.all(ids.map((id) => input.deleteEvent(id)));
  return ids.length;
}
