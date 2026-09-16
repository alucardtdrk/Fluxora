import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { readSession } from "../auth.js";
import { getFluxoraUser, type FluxoraRole } from "../access.js";

export type SessionUser = { id: number; name: string; email: string; role: FluxoraRole };
export type TrpcContext = { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; user: SessionUser | null };

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const session = readSession(opts.req);
  let user: SessionUser | null = null;
  if (session) {
    const access = await getFluxoraUser(session.email).catch(() => null);
    if (access?.active) user = { ...session, name: access.name || session.name, role: access.role };
  }
  return { req: opts.req, res: opts.res, user };
}
