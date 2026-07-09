import type { InboxListItem } from "@/app/components/ClientFilteredInboxList"
import InboxRowWithSnooze from "@/app/components/InboxRowWithSnooze"

type Props = Omit<InboxListItem, "isSelected"> & { isSelected?: boolean }

/**
 * Full-width horizontal row for the Mail table. Delegates all hover actions
 * (read/unread, status, snooze, archive, done/reopen) to InboxRowWithSnooze /
 * InboxRow so no API call site is duplicated — this component only changes
 * layout (full-width sender/subject/snippet/timestamp columns) via a wrapper
 * className, not behavior.
 */
export default function MailInboxRow(props: Props) {
  return (
    <div className="w-full border-b border-slate-100 last:border-b-0">
      <InboxRowWithSnooze {...props} isSelected={props.isSelected ?? false} />
    </div>
  )
}
