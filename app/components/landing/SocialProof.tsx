const ROUNDS_LOGO = "https://www.figma.com/api/mcp/asset/3c303f40-fdef-477f-a258-bb033373131a";

const logos = [
  { name: "Rounds" },
  { name: "Rounds" },
  { name: "Rounds" },
  { name: "Rounds" },
];

function TestimonialLogo({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-6 h-6 relative shrink-0">
        <img alt="" src={ROUNDS_LOGO} className="absolute inset-0 w-full h-full object-contain" />
      </div>
      <span className="text-[18px] font-semibold text-black whitespace-nowrap">
        {name}
      </span>
    </div>
  );
}

export default function SocialProof() {
  return (
    <section className="bg-white border-t border-black/[0.06] py-10 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-8 items-center text-center">
        <div className="flex flex-col gap-4 items-center w-full">
          <p className="text-xl font-normal text-black">
            Built for teams that live in conversations
          </p>
          <p className="text-base text-[#6b6f76]">
            Used by founders, sales teams, recruiters, agencies, and consultants
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16 w-full">
          {logos.map((logo, i) => (
            <TestimonialLogo key={i} name={logo.name} />
          ))}
        </div>
      </div>
    </section>
  );
}
