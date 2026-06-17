import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Reuse across hot reloads in dev AND across route invocations in prod to avoid
// exhausting the Postgres connection limit on Railway's shared Postgres instance.
export const prisma = global.prisma ?? new PrismaClient();

global.prisma = prisma;
