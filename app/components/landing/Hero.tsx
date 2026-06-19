import Link from "next/link";

const conversations = [
  {
    initials: "SC", name: "Sarah Chen", preview: "Hi! I saw your product demo...", time: "1m",
    tag: "Lead", tagColor: "indigo" as const, avatarBg: "bg-indigo-500", active: true,
  },
  {
    initials: "MJ", name: "Mike Johnson", preview: "Can you help me with my acc...", time: "5m",
    tag: "Support", tagColor: "violet" as const, avatarBg: "bg-violet-500", active: false,
  },
  {
    initials: "ED", name: "Emma Davis", preview: "Looking forward to the demo", time: "10m",
    tag: "Lead", tagColor: "indigo" as const, avatarBg: "bg-emerald-500", active: false,
  },
  {
    initials: "AR", name: "Alex Rivera", preview: "Question about pricing", time: "30m",
    tag: null, tagColor: null, avatarBg: "bg-amber-500", active: false,
  },
];

const tagStyles = {
  indigo: "bg-indigo-500/15 text-indigo-400",
  violet: "bg-violet-500/15 text-violet-400",
};

export default function Hero() {
  return (
    <section id="hero" className="relative bg-[#09090b] pt-16 pb-28 px-4 sm:px-6 overflow-hidden">
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Top center glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[320px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center top, rgba(99,102,241,0.18) 0%, transparent 65%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Headline block */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span className="inline-flex items-center gap-2 mb-6 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/55 tracking-wide uppercase backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Now in early access
          </span>

          <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl text-white leading-[1.06] mb-6">
            One inbox for every{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(135deg, #818cf8 0%, #a78bfa 100%)",
              }}
            >
              conversation.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-white/60 leading-relaxed mb-10 max-w-md mx-auto">
            Email and texts, unified. Draft replies faster with AI — never miss a follow-up.
          </p>

          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/30"
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
              }}
            >
              Get started free
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-5 py-3 text-sm font-medium text-white/75 hover:bg-white/10 transition-colors backdrop-blur-sm"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Product mockup */}
        <div className="relative mx-auto max-w-5xl">
          {/* Glow beneath mockup */}
          <div
            className="absolute -inset-x-4 top-8 bottom-0 pointer-events-none rounded-2xl"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 20%, rgba(99,102,241,0.14) 0%, transparent 70%)",
            }}
          />

          <div className="relative rounded-t-2xl border border-white/10 bg-[#18181b] overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/[0.06] bg-black/30">
              <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
              <div className="h-3 w-3 rounded-full bg-[#28c840]" />
              <div className="flex-1 flex justify-center">
                <div className="rounded-md bg-white/[0.06] px-8 py-1 text-[11px] text-white/25 font-mono tracking-tight">
                  app.flowdesk.io/inbox
                </div>
              </div>
              <div className="w-16" />
            </div>

            {/* 3-panel layout */}
            <div className="flex h-[330px] sm:h-[380px]">

              {/* LEFT — conversation list */}
              <div className="hidden sm:flex w-52 shrink-0 border-r border-white/[0.06] flex-col bg-black/20">
                <div className="p-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/25" aria-hidden="true">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                    <span className="text-[11px] text-white/25">Search conversations…</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
                  {conversations.map((c) => (
                    <div
                      key={c.name}
                      className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${
                        c.active ? "bg-indigo-500/10" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <div
                        className={`shrink-0 h-8 w-8 rounded-full ${c.avatarBg} flex items-center justify-center text-[11px] font-semibold text-white`}
                      >
                        {c.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] font-semibold text-white/80 truncate">{c.name}</span>
                          <span className="text-[10px] text-white/25 shrink-0 ml-1">{c.time}</span>
                        </div>
                        {c.tag && (
                          <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-0.5 ${tagStyles[c.tagColor!]}`}>
                            {c.tag}
                          </span>
                        )}
                        <p className="text-[10px] text-white/30 truncate leading-tight">{c.preview}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CENTER — chat pane */}
              <div className="flex-1 flex flex-col min-w-0 bg-[#18181b]">
                <div className="h-12 border-b border-white/[0.06] px-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-indigo-500 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                      SC
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold text-white/90 leading-none mb-0.5">Sarah Chen</div>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="text-[10px] text-white/30">Active now</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button className="text-[10px] text-white/35 border border-white/[0.08] rounded-md px-2.5 py-1 hover:bg-white/5 transition-colors">
                      Schedule
                    </button>
                    <button className="text-[10px] text-white/35 border border-white/[0.08] rounded-md px-2.5 py-1 hover:bg-white/5 transition-colors">
                      Close
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <div className="flex justify-start">
                    <div className="max-w-[70%] rounded-2xl rounded-tl-sm bg-white/[0.08] px-3.5 py-2.5">
                      <p className="text-[11px] text-white/75 leading-relaxed">
                        Hi! I saw your product demo and I'm really interested in learning more about the enterprise features.
                      </p>
                      <p className="text-[9px] text-white/25 mt-1.5">10:24 AM</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div
                      className="max-w-[70%] rounded-2xl rounded-tr-sm px-3.5 py-2.5"
                      style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
                    >
                      <p className="text-[11px] text-white/90 leading-relaxed">
                        Hi Sarah! Thanks for reaching out. I'd be happy to walk you through our enterprise features.
                      </p>
                      <p className="text-[9px] text-white/50 mt-1.5">10:31 AM</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[70%] rounded-2xl rounded-tl-sm bg-white/[0.08] px-3.5 py-2.5">
                      <p className="text-[11px] text-white/75 leading-relaxed">
                        That would be great! What's the best time for a call?
                      </p>
                      <p className="text-[9px] text-white/25 mt-1.5">10:33 AM</p>
                    </div>
                  </div>
                </div>

                <div className="p-3 border-t border-white/[0.06] shrink-0">
                  <div className="rounded-xl bg-white/[0.06] px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-white/20">Type a message…</span>
                    <button
                      className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity"
                      style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white" aria-hidden="true">
                        <path d="M22 2 11 13M22 2 15 22 11 13 2 9l20-7z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT — AI assistant */}
              <div className="hidden lg:flex w-52 shrink-0 border-l border-white/[0.06] flex-col bg-black/20">
                <div className="p-3 border-b border-white/[0.06] flex items-center gap-2">
                  <div className="h-5 w-5 rounded-md bg-indigo-500/20 flex items-center justify-center shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400" aria-hidden="true">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-semibold text-white/60">AI Assistant</span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {/* Suggested reply */}
                  <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-400" aria-hidden="true">
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
                      </svg>
                      <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                        Suggested Reply
                      </span>
                    </div>
                    <p className="text-[10px] text-white/65 leading-relaxed">
                      "I'd be happy to schedule a call! How does Thursday at 3 PM PST work? I'll send a calendar invite with all the details."
                    </p>
                    <div className="flex gap-1.5 mt-3">
                      <button
                        className="flex-1 rounded-lg py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
                      >
                        Send
                      </button>
                      <button className="flex-1 rounded-lg border border-white/[0.1] py-1.5 text-[10px] font-medium text-white/45 hover:bg-white/5 transition-colors">
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Contact info */}
                  <div>
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest mb-2">Contact Info</p>
                    <div className="space-y-1">
                      <p className="text-[10px] text-white/55">sarah@company.com</p>
                      <p className="text-[10px] text-white/55">TechCorp Inc.</p>
                      <p className="text-[10px] text-white/30">VP of Engineering</p>
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-widest mb-2">Tags</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold px-2.5 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Active Lead
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Gradient transition to white — absolute so it spans full section width past px padding */}
      <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-b from-[#09090b] to-white pointer-events-none" />
    </section>
  );
}
