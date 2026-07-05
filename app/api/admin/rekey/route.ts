import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { reEncryptString } from "@/lib/crypto"

// Re-encrypts all credential fields for the current tenant from the old key to the new key.
// Rotation procedure:
//   1. Set ENCRYPTION_SECRET_PREVIOUS = old key
//   2. Set ENCRYPTION_SECRET = new key
//   3. Deploy
//   4. POST /api/admin/rekey
//   5. Confirm response shows errors: 0, then unset ENCRYPTION_SECRET_PREVIOUS
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  let rekeyed = 0
  let errors = 0

  // GmailCredential
  const gmailCreds = await prisma.gmailCredential.findMany({
    where: { channel: { tenantId } },
    select: { id: true, accessTokenEncrypted: true, refreshTokenEncrypted: true },
  })
  for (const cred of gmailCreds) {
    try {
      await prisma.gmailCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEncrypted: reEncryptString(cred.accessTokenEncrypted),
          refreshTokenEncrypted: reEncryptString(cred.refreshTokenEncrypted),
        },
      })
      rekeyed++
    } catch {
      errors++
    }
  }

  // GoogleCalendarCredential
  const calCreds = await prisma.googleCalendarCredential.findMany({
    where: { tenantId },
    select: { id: true, accessTokenEncrypted: true, refreshTokenEncrypted: true },
  })
  for (const cred of calCreds) {
    try {
      await prisma.googleCalendarCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEncrypted: reEncryptString(cred.accessTokenEncrypted),
          refreshTokenEncrypted: reEncryptString(cred.refreshTokenEncrypted),
        },
      })
      rekeyed++
    } catch {
      errors++
    }
  }

  // GoogleDriveCredential
  const driveCreds = await prisma.googleDriveCredential.findMany({
    where: { tenantId },
    select: { id: true, accessTokenEncrypted: true, refreshTokenEncrypted: true },
  })
  for (const cred of driveCreds) {
    try {
      await prisma.googleDriveCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEncrypted: reEncryptString(cred.accessTokenEncrypted),
          refreshTokenEncrypted: reEncryptString(cred.refreshTokenEncrypted),
        },
      })
      rekeyed++
    } catch {
      errors++
    }
  }

  // OutlookCredential
  const outlookCreds = await prisma.outlookCredential.findMany({
    where: { channel: { tenantId } },
    select: {
      id: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      deltaLinkEncrypted: true,
      subscriptionClientStateEncrypted: true,
    },
  })
  for (const cred of outlookCreds) {
    try {
      await prisma.outlookCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEncrypted: reEncryptString(cred.accessTokenEncrypted),
          refreshTokenEncrypted: reEncryptString(cred.refreshTokenEncrypted),
          deltaLinkEncrypted: cred.deltaLinkEncrypted ? reEncryptString(cred.deltaLinkEncrypted) : cred.deltaLinkEncrypted,
          subscriptionClientStateEncrypted: cred.subscriptionClientStateEncrypted
            ? reEncryptString(cred.subscriptionClientStateEncrypted)
            : cred.subscriptionClientStateEncrypted,
        },
      })
      rekeyed++
    } catch {
      errors++
    }
  }

  // MindBodyCredential
  const mbCreds = await prisma.mindBodyCredential.findMany({
    where: { tenantId },
    select: { id: true, usernameEncrypted: true, passwordEncrypted: true },
  })
  for (const cred of mbCreds) {
    try {
      await prisma.mindBodyCredential.update({
        where: { id: cred.id },
        data: {
          usernameEncrypted: reEncryptString(cred.usernameEncrypted),
          passwordEncrypted: reEncryptString(cred.passwordEncrypted),
        },
      })
      rekeyed++
    } catch {
      errors++
    }
  }

  return NextResponse.json({ rekeyed, errors })
}
