import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getGoogleAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
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

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: auth.refreshToken });
  return google.gmail({ version: "v1", auth: client });
}
