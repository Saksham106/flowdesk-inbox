import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      channel: true,
      contact: true,
    },
  });

  const needsReplyCount = conversations.filter(
    (c) => c.status === "needs_reply"
  ).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <AutoRefresh intervalMs={10000} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Inbox</h1>
            <p className="text-sm text-slate-500">
              {needsReplyCount > 0 ? (
                <span className="font-medium text-red-600">{needsReplyCount} need{needsReplyCount === 1 ? "s" : ""} reply</span>
              ) : (
                "All caught up"
              )}
              {" · "}{conversations.length} total
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="space-y-3">
          {conversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-500">
              No conversations yet. Send a test SMS to your Twilio number.
            </div>
          ) : (
            conversations.map((conversation) => {
              const lastMessage = conversation.messages[0];
              const displayName = conversation.contact?.name ?? conversation.externalThreadId;
              return (
                <Link
                  key={conversation.id}
                  href={`/conversations/${conversation.id}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{displayName}</p>
                      <StatusBadge status={conversation.status} />
                      {conversation.label && <LabelBadge label={conversation.label} />}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {lastMessage?.body ?? "No messages yet"}
                    </p>
                  </div>
                  <div className="ml-4 shrink-0 text-xs text-slate-400">
                    {conversation.lastMessageAt.toLocaleString()}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
