import ScrollReveal from "@/app/components/ScrollReveal";

export default function SocialProof() {
  return (
    <section className="bg-white border-t border-black/[0.06] py-16 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 items-center text-center">
        <ScrollReveal>
          <div className="flex flex-col gap-[4px] items-center w-full">
            <p className="text-xl font-normal text-black">
              Built for teams that live in conversations
            </p>
            <p className="text-base text-[#6b6f76]">
              Used by founders, sales teams, recruiters, agencies, and consultants
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
