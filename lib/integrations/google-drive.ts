import { createHmac } from "crypto"
import { google } from "googleapis"
import { encryptString, decryptString } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"

function getDriveAuth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/integrations/google-drive/callback`
  )
}

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

export function getGoogleDriveAuthUrl(state: string): string {
  const auth = getDriveAuth()
  return auth.generateAuthUrl({
    access_type: "offline",
    scope: DRIVE_SCOPES,
    state,
    prompt: "consent",
  })
}

// State tokens use a "drive:" prefix to namespace from Gmail/Calendar state.
// HMAC-signed with NEXTAUTH_SECRET for CSRF protection.
export function signDriveState(tenantId: string): string {
  const ts = Date.now().toString()
  const hmac = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`drive:${tenantId}:${ts}`)
    .digest("hex")
  return Buffer.from(`drive:${tenantId}:${ts}:${hmac}`).toString("base64url")
}

export function verifyDriveState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8")
    const parts = decoded.split(":")
    if (parts.length < 4 || parts[0] !== "drive") return null
    const hmac = parts[parts.length - 1]
    const ts = parts[parts.length - 2]
    const tenantId = parts.slice(1, parts.length - 2).join(":")
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(`drive:${tenantId}:${ts}`)
      .digest("hex")
    if (hmac !== expected) return null
    if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null
    return tenantId
  } catch {
    return null
  }
}

export async function exchangeGoogleDriveCode(
  code: string,
  tenantId: string
): Promise<{ email: string }> {
  const auth = getDriveAuth()
  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)

  const oauth2 = google.oauth2({ version: "v2", auth })
  const userInfo = await oauth2.userinfo.get()
  const email = userInfo.data.email ?? ""

  await prisma.googleDriveCredential.upsert({
    where: { tenantId },
    update: {
      email,
      accessTokenEncrypted: encryptString(tokens.access_token ?? ""),
      refreshTokenEncrypted: encryptString(tokens.refresh_token ?? ""),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
    create: {
      tenantId,
      email,
      accessTokenEncrypted: encryptString(tokens.access_token ?? ""),
      refreshTokenEncrypted: encryptString(tokens.refresh_token ?? ""),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
  })
  return { email }
}

export type DriveFileResult = { name: string; snippet: string; webViewLink: string }

export async function searchDriveForContext(
  tenantId: string,
  query: string
): Promise<DriveFileResult[]> {
  const cred = await prisma.googleDriveCredential.findUnique({ where: { tenantId } })
  if (!cred) return []

  const auth = getDriveAuth()
  auth.setCredentials({
    access_token: decryptString(cred.accessTokenEncrypted),
    refresh_token: decryptString(cred.refreshTokenEncrypted),
    expiry_date: cred.tokenExpiry?.getTime(),
  })

  // Persist refreshed tokens automatically
  auth.on("tokens", async (refreshed) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    if (refreshed.access_token) updates.accessTokenEncrypted = encryptString(refreshed.access_token)
    if (refreshed.expiry_date) updates.tokenExpiry = new Date(refreshed.expiry_date)
    if (refreshed.refresh_token) updates.refreshTokenEncrypted = encryptString(refreshed.refresh_token)
    if (Object.keys(updates).length > 0) {
      await prisma.googleDriveCredential.update({ where: { tenantId }, data: updates })
    }
  })

  const drive = google.drive({ version: "v3", auth })
  const res = await drive.files.list({
    q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    pageSize: 3,
  })

  return (res.data.files ?? []).map((f) => ({
    name: f.name ?? "",
    snippet: "",
    webViewLink: f.webViewLink ?? "",
  }))
}
