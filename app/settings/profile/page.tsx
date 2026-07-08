import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesCrmEnabled } from "@/lib/tenant-capabilities";
import SalesCrmModeToggle from "@/app/settings/SalesCrmModeToggle";
import VipContactsForm from "@/app/settings/VipContactsForm";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [tenant, vipContacts] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.vipContact.findMany({
      where: { tenantId: session.user.tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, label: true },
    }),
  ]);

  const isSalesCrmEnabled = salesCrmEnabled(tenant);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Features</h2>
        </div>
        <div className="px-6 py-4">
          <SalesCrmModeToggle enabled={isSalesCrmEnabled} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-5">
          <VipContactsForm initialVips={vipContacts} />
        </div>
      </section>
    </>
  );
}
