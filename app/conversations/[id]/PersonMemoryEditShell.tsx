"use client"

import { useState } from "react"
import PersonMemoryEditPanel from "./PersonMemoryEditPanel"

export default function PersonMemoryEditShell({
  contactId,
  memory,
}: {
  contactId: string
  memory: {
    summary: string | null
    preferences: string | null
    openQuestions: string | null
    promisedActions: string | null
  }
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="mt-1 text-xs text-blue-600 hover:underline"
        >
          Edit
        </button>
      )}
      {editing && (
        <PersonMemoryEditPanel
          contactId={contactId}
          initial={{
            summary: memory.summary ?? "",
            preferences: memory.preferences ?? "",
            openQuestions: memory.openQuestions ?? "",
            promisedActions: memory.promisedActions ?? "",
          }}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  )
}
