import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import ChatInterface from "./ChatInterface"

export default async function ChatPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-900">Inbox Chat</h1>
        <p className="text-xs text-slate-400">Ask questions about your emails</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  )
}
