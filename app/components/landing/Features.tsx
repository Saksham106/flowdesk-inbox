import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

const features: Array<{
  title: string;
  description: string;
  cta: string;
  imageLeft: boolean;
  image: string;
  imageAlt: string;
}> = [
  {
    title: "A tidy inbox, automatically",
    description:
      "FlowDesk reads every incoming email and sorts it with Gmail labels — what needs you rises to the top, and the noise quietly steps aside.",
    cta: "Get a tidier inbox",
    imageLeft: true,
    image: "/images/landing/feature-tidy-inbox.png",
    imageAlt: "Gmail inbox rows sorted with FlowDesk labels like Newsletter, Handled, and Needs Action",
  },
  {
    title: "Replies drafted in your voice",
    description:
      "It learns how you write from the emails you've already sent, then leaves ready-to-go drafts right in Gmail. You tweak or just hit send.",
    cta: "See drafts that sound like you",
    imageLeft: false,
    image: "/images/landing/feature-drafts.png",
    imageAlt: "A reply drafted by FlowDesk awaiting review",
  },
  {
    title: "Follow-ups that remember for you",
    description:
      "FlowDesk keeps track of who still owes you a reply and nudges the thread at the right moment — and when someone proposes a time, it can put it straight on your calendar.",
    cta: "Stop dropping threads",
    imageLeft: true,
    image: "/images/landing/feature-followups.png",
    imageAlt: "FlowDesk tracking threads that still need a reply",
  },
];

function ProductImageCard({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex-1 min-w-0 relative rounded-xl overflow-hidden self-stretch bg-[#e0e1ec]" style={{ minHeight: 360 }}>
      <img
        src="/images/landing/feature-image.png"
        alt=""
        aria-hidden="true"
        width={256}
        height={256}
        className="absolute inset-0 w-full h-full object-cover rounded-xl"
      />
      <img
        src={src}
        alt={alt}
        width={3832}
        height={2396}
        className="absolute inset-0 w-full h-full object-cover object-top"
      />
    </div>
  );
}

function FeatureContent({ feature }: { feature: typeof features[number] }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-6 justify-center">
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-black">{feature.title}</h3>
        <p className="text-lg font-normal text-[#6b6f76] leading-snug">{feature.description}</p>
      </div>
      <div>
        <Link
          href="/login?signup=1"
          className="inline-flex items-center justify-center bg-black text-white text-sm rounded px-6 py-2 hover:opacity-85 transition-opacity"
        >
          {feature.cta}
        </Link>
      </div>
    </div>
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

        {features.map((feature, i) => (
          <ScrollReveal key={i} delay={i * 80}>
            <div
              className="landing-card flex flex-col lg:flex-row gap-16 items-stretch bg-[#f5f5f4] rounded-lg p-4 overflow-hidden"
              style={{ minHeight: 500 }}
            >
              {feature.imageLeft ? (
                <>
                  <ProductImageCard src={feature.image} alt={feature.imageAlt} />
                  <FeatureContent feature={feature} />
                </>
              ) : (
                <>
                  <FeatureContent feature={feature} />
                  <ProductImageCard src={feature.image} alt={feature.imageAlt} />
                </>
              )}
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
