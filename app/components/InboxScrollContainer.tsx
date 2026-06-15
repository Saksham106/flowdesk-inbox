"use client"

import { useEffect, useRef, type ReactNode } from "react"

interface Props {
  scrollKey: string
  children: ReactNode
  className?: string
}

export default function InboxScrollContainer({ scrollKey, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = `flowdesk.inbox.scroll.${scrollKey}`

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const saved = sessionStorage.getItem(storageKey)
    if (saved !== null) {
      el.scrollTop = Number(saved)
    }

    function onScroll() {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        sessionStorage.setItem(storageKey, String(el!.scrollTop))
      }, 200)
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [storageKey])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
