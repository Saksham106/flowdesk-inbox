const bullets = [
  { label: "Faster replies", description: "Cut response times with smart drafts and keyboard-first shortcuts." },
  { label: "Clear ownership", description: "Assign conversations to teammates so nothing slips through the cracks." },
  { label: "Less busywork", description: "Labels, reminders, and routing handle the sorting so you don't have to." },
];

export default function SocialProof() {
  return (
    <section className="py-16 px-6 border-y border-neutral-100 bg-neutral-50">
      <div className="max-w-6xl mx-auto">
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-400 text-center mb-10">
          Built for teams that move fast.
        </p>
        <div className="grid sm:grid-cols-3 gap-8">
          {bullets.map((b) => (
            <div key={b.label} className="text-center">
              <p className="text-base font-semibold text-neutral-900 mb-1">{b.label}</p>
              <p className="text-sm text-neutral-500 leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
