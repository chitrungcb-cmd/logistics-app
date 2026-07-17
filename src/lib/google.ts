import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/secret-encryption";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
export const GOOGLE_OAUTH_STATE_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-google-oauth-state"
  : "google-oauth-state";

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getGoogleAuthUrl(state: string) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Returns the most recently connected Gmail account, or null if none is connected yet. */
export async function getGmailAuthRecord() {
  return prisma.gmailAuth.findFirst({ orderBy: { updatedAt: "desc" } });
}

/** Returns an authorized Gmail API client using the stored refresh token, or null if not connected. */
export async function getAuthorizedGmailClient() {
  const auth = await getGmailAuthRecord();
  if (!auth) return null;

  const refreshToken = decryptSecret(auth.refreshToken);
  // Transparently upgrade the one legacy plaintext token after TOKEN_ENCRYPTION_KEY is configured.
  // The Gmail API call does not need to wait for a manual reconnect just to gain at-rest encryption.
  if (!isEncryptedSecret(auth.refreshToken) && process.env.TOKEN_ENCRYPTION_KEY) {
    await prisma.gmailAuth.update({
      where: { id: auth.id },
      data: { refreshToken: encryptSecret(refreshToken) },
    });
  }

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: client });
}
