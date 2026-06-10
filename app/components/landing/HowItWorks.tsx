const steps = [
  {
    number: "01",
    title: "Connect",
    description:
      "Link your email accounts and a dedicated phone number in minutes. No IT ticket required.",
  },
  {
    number: "02",
    title: "Triage",
    description:
      "Incoming messages are automatically labeled and routed. The urgent stuff surfaces to the top.",
  },
  {
    number: "03",
    title: "Reply",
    description:
      "Review Copilot-drafted replies, make edits if needed, and send — or let Autopilot handle the routine ones.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 px-6 bg-neutral-50 border-y border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900">
            Up and running in minutes.
          </h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-8 relative">
          <div className="hidden sm:block absolute top-6 left-[calc(16.66%+16px)] right-[calc(16.66%+16px)] h-px bg-neutral-200" aria-hidden="true" />

          {steps.map((step) => (
            <div key={step.number} className="relative flex flex-col items-start">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-500 shadow-sm">
                {step.number}
              </div>
              <h3 className="text-base font-semibold text-neutral-900 mb-1.5">{step.title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
