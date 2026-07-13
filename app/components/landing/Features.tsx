import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

// Each card is anchored by a Gmail-label-style chip — the artifact the
// feature actually produces in your inbox — instead of a screenshot.
const features: Array<{
  title: string;
  description: string;
  cta: string;
  chip: { text: string; bg: string; fg: string; dot: string };
}> = [
  {
    title: "A tidy inbox, automatically",
    description:
      "FlowDesk reads every incoming email and sorts it with Gmail labels — what needs you rises to the top, and the noise quietly steps aside.",
    cta: "Get a tidier inbox",
    chip: { text: "Needs action", bg: "#f3ead6", fg: "#7a5a1e", dot: "#c9922e" },
  },
  {
    title: "Replies drafted in your voice",
    description:
      "It learns how you write from the emails you've already sent, then leaves ready-to-go drafts right in Gmail. You tweak or just hit send.",
    cta: "See drafts that sound like you",
    chip: { text: "Draft ready", bg: "#e2eaf4", fg: "#39597f", dot: "#5b83b3" },
  },
  {
    title: "Follow-ups that remember for you",
    description:
      "FlowDesk keeps track of who still owes you a reply and nudges the thread at the right moment — and when someone proposes a time, it can put it straight on your calendar.",
    cta: "Stop dropping threads",
    chip: { text: "Waiting on reply", bg: "#eae5f2", fg: "#584b7e", dot: "#8272ad" },
  },
  {
    title: "Bulk archive and unsubscribe",
    description:
      "Years of newsletters don't deserve one-by-one cleanup. FlowDesk groups the clutter by sender, so you can archive thousands of emails and unsubscribe from the senders behind them in a couple of clicks.",
    cta: "Clear out the backlog",
    chip: { text: "182 archived", bg: "#e2efe4", fg: "#3c6647", dot: "#5f9a6e" },
  },
];

function LabelChip({ chip }: { chip: typeof features[number]["chip"] }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium w-fit"
      style={{ backgroundColor: chip.bg, color: chip.fg }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ backgroundColor: chip.dot }}
      />
      {chip.text}
    </span>
  );
}

export default function Features() {
  return (
    <section id="features" className="py-20 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        <ScrollReveal>
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#6b6f76] font-medium">What it does</p>
            <h2
              className="text-[36px] leading-[1.15] font-normal text-black"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              Your email, handled the way you would
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map((feature, i) => (
            <ScrollReveal key={i} delay={i * 80} className="h-full">
              <div className="landing-card group h-full bg-[#f5f5f4] rounded-lg p-8 sm:p-10 flex flex-col gap-6">
                <LabelChip chip={feature.chip} />
                <div className="flex flex-col gap-3">
                  <h3
                    className="text-[26px] leading-[1.2] font-normal text-black"
                    style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
                  >
                    {feature.title}
                  </h3>
                  <p className="text-base text-[#6b6f76] leading-relaxed">{feature.description}</p>
                </div>
                <div className="mt-auto pt-2">
                  <Link
                    href="/login?signup=1"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-black"
                  >
                    {feature.cta}
                    <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
                      →
                    </span>
                  </Link>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
