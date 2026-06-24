import Link from "next/link";

const PRODUCT_SCREENSHOT = "https://www.figma.com/api/mcp/asset/8d88d50a-31f6-48ff-9335-8d78e4561fe6";
const HERO_BG = "https://www.figma.com/api/mcp/asset/30ec1d4f-0442-4a81-9019-29e2f949bc09";

export default function Hero() {
  return (
    <section id="hero" className="relative overflow-hidden bg-white">
      {/* Background gradient image */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <img
          alt=""
          src={HERO_BG}
          className="absolute w-[124%] h-[123%] top-[-11%] left-0 object-cover"
          aria-hidden="true"
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col items-center">
        {/* Headline block */}
        <div className="pt-16 pb-10 flex flex-col items-center gap-8 w-full max-w-2xl mx-auto text-center">
          <h1 className="text-[56px] leading-[60px] font-normal text-black w-full">
            Your inbox, on autopilot
          </h1>

          <p className="text-base font-medium text-[#404040] max-w-lg leading-relaxed">
            Automatically manages conversations, draft responses, and keeps follow-ups moving without lifting a finger.
          </p>

          <div className="flex flex-wrap gap-1 justify-center">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center justify-center rounded-lg bg-black px-6 py-2 text-sm text-white hover:opacity-85 transition-opacity"
            >
              Get Started
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-lg border border-black px-6 py-2 text-sm text-black hover:bg-neutral-50 transition-colors"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Product screenshot */}
        <div className="w-full flex items-start justify-center pb-0">
          <div className="border border-[#e0e1ec] shadow-[0px_8px_0px_0px_rgba(0,0,0,0.25)] rounded-t-xl overflow-hidden w-full max-w-4xl">
            <img
              src={PRODUCT_SCREENSHOT}
              alt="Flowdesk inbox screenshot"
              className="w-full object-cover object-top"
              style={{ display: "block" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
