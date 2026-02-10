import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
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

        const found = db
          .select()
          .from(user)
          .where(eq(user.email, email))
          .get();

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
        const existing = db
          .select()
          .from(user)
          .where(eq(user.email, authUser.email))
          .get();

        if (existing) {
          token.id = existing.id;
        } else {
          // Create user + default workspace for OAuth sign-ups
          const [newUser] = db
            .insert(user)
            .values({
              name: authUser.name || authUser.email,
              email: authUser.email,
              image: authUser.image,
            })
            .returning()
            .all();

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

function createDefaultWorkspace(userId: string, userName: string) {
  const [ws] = db
    .insert(workspace)
    .values({
      name: `${userName}'s Workspace`,
      description: "Personal mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning()
    .all();

  db.insert(userWorkspace)
    .values({ userId, workspaceId: ws.id, role: "owner" })
    .run();
}
