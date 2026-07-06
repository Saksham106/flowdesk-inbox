import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

const features: Array<{
  title: string;
  description: string;
  cta: string;
  imageLeft: boolean;
}> = [
  {
    title: "Automatic follow-up",
    description:
      "Flowdesk sends timely follow-ups so prospects do not disappear just because you got busy.",
    cta: "Never miss a follow-up",
    imageLeft: true,
  },
  {
    title: "Replies with context",
    description:
      "Flowdesk understands replies, answers common questions, and keeps momentum moving toward a meeting.",
    cta: "Watch conversations move",
    imageLeft: false,
  },
  {
    title: "Meetings on your calendar",
    description:
      "Once there is intent, Flowdesk coordinates availability and books the meeting directly so the opportunity does not stall.",
    cta: "Book meetings 24/7",
    imageLeft: true,
  },
];

function ProductImageCard() {
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
        src="/images/landing/product-screenshot.png"
        alt="Flowdesk product screenshot"
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
            <p className="text-sm text-black font-normal">{"// How it works"}</p>
            <h2 className="text-[36px] leading-[1] font-normal text-black">
              Never let a conversation die again
            </h2>
          </div>
        </ScrollReveal>

        {features.map((feature, i) => (
          <ScrollReveal key={i} delay={i * 80}>
            <div
              className="flex flex-col lg:flex-row gap-16 items-stretch bg-[#f5f5f4] rounded-lg p-4 overflow-hidden"
              style={{ minHeight: 500 }}
            >
              {feature.imageLeft ? (
                <>
                  <ProductImageCard />
                  <FeatureContent feature={feature} />
                </>
              ) : (
                <>
                  <FeatureContent feature={feature} />
                  <ProductImageCard />
                </>
              )}
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
