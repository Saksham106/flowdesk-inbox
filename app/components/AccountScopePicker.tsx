"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

export type MailboxAccount = {
  id: string
  emailAddress: string | null
  provider: string
}

export default function AccountScopePicker({
  accounts,
  activeAccountId,
}: {
  accounts: MailboxAccount[]
  activeAccountId: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  if (accounts.length < 2) return null

  return (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
      Inbox
      <select
        aria-label="Inbox account"
        value={activeAccountId ?? "all"}
        onChange={(event) => {
          const next = new URLSearchParams(searchParams.toString())
          const value = event.target.value
          if (value === "all") next.delete("account")
          else next.set("account", value)
          next.delete("page")
          const query = next.toString()
          router.push(query ? `${pathname}?${query}` : pathname)
        }}
        className="max-w-64 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 shadow-sm"
      >
        <option value="all">All accounts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.emailAddress ?? `${account.provider} account`}
          </option>
        ))}
      </select>
    </label>
  )
}
