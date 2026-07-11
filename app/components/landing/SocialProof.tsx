import ScrollReveal from "@/app/components/ScrollReveal";

export default function SocialProof() {
  return (
    <section className="bg-white border-t border-black/[0.06] py-16 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 items-center text-center">
        <ScrollReveal>
          <div className="flex flex-col gap-[4px] items-center w-full">
            <p className="text-xl font-normal text-black">
              Works inside the Gmail you already use
            </p>
            <p className="text-base text-[#6b6f76]">
              Labels, drafts, and threads stay in Gmail — nothing to migrate, nothing new to learn
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
