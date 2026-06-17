import { prisma } from "@/lib/prisma"

export type VipDetectorResult = {
  isVip: boolean
  label?: string
}

export async function detectVip(
  fromEmail: string,
  tenantId: string
): Promise<VipDetectorResult> {
  const emailLower = fromEmail.toLowerCase()
  const domain = emailLower.split("@")[1] ?? ""

  const match = await prisma.vipContact.findFirst({
    where: {
      tenantId,
      OR: [
        { email: emailLower },
        { domain: domain },
      ],
    },
    select: { label: true },
  })

  if (!match) return { isVip: false }
  return { isVip: true, label: match.label ?? undefined }
}
