import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { user, workspace, userWorkspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type {} from "./types";

const providers: Provider[] = [
  Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const found = (await db
          .select()
          .from(user)
          .where(eq(user.email, email))
          )[0];

        if (!found?.passwordHash) return null;

        const valid = await bcrypt.compare(password, found.passwordHash);
        if (!valid) return null;

        return { id: found.id, name: found.name, email: found.email, image: found.image };
      },
  }),
];

// Only register Google provider when credentials are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.unshift(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// Only register Microsoft Entra ID provider when credentials are configured
if (process.env.MICROSOFT_ENTRA_ID_CLIENT_ID && process.env.MICROSOFT_ENTRA_ID_CLIENT_SECRET) {
  providers.unshift(
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_ENTRA_ID_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_ENTRA_ID_CLIENT_SECRET,
      // "organizations" allows any Azure AD tenant (multi-tenant)
      // Use a specific tenant ID to restrict to one org
      tenantId: process.env.MICROSOFT_ENTRA_ID_TENANT_ID || "organizations",
    } as Parameters<typeof MicrosoftEntraID>[0])
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user: authUser, account }) {
      // On first sign-in, persist the user ID in the token
      if (authUser?.id) {
        token.id = authUser.id;
      }

      // For OAuth sign-ins, find or create the user record
      if (account && account.provider !== "credentials" && authUser?.email) {
        const existing = (await db
          .select()
          .from(user)
          .where(eq(user.email, authUser.email))
          )[0];

        if (existing) {
          token.id = existing.id;
        } else {
          // Create user + default workspace for OAuth sign-ups
          const [newUser] = await db
            .insert(user)
            .values({
              name: authUser.name || authUser.email,
              email: authUser.email,
              image: authUser.image,
            })
            .returning()
            ;

          token.id = newUser.id;
          createDefaultWorkspace(newUser.id, newUser.name || "My Workspace");
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }
      return session;
    },
  },
});

async function createDefaultWorkspace(userId: string, userName: string) {
  const [ws] = await db
    .insert(workspace)
    .values({
      name: `${userName}'s Workspace`,
      description: "Personal mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning()
    ;

  await db.insert(userWorkspace)
    .values({ userId, workspaceId: ws.id, role: "owner" })
    ;
}
