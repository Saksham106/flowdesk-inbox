import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { accountModeFor } from "@/lib/tenant-capabilities";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        let user;
        try {
          user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { tenant: { select: { salesCrmEnabled: true } } },
          });
        } catch (error) {
          console.error("[auth] authorize lookup failed:", error);
          // Thrown messages surface in the client redirect URL, so keep this
          // opaque — raw Prisma errors leak internal hostnames.
          throw new Error("service_unavailable");
        }

        if (!user) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId,
          // Session carries the derived internal mode (B2C: sourced from the
          // Sales & CRM capability, not a stored account identity).
          accountType: accountModeFor(user.tenant),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = (user as unknown as { tenantId: string }).tenantId;
        token.accountType = (user as unknown as { accountType: string }).accountType;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as Record<string, unknown>;
        u.id = token.id as string;
        u.tenantId = token.tenantId as string;
        u.accountType = token.accountType as string;
      }
      return session;
    },
  },
};
