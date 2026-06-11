import Link from "next/link";

export default function FinalCTA() {
  return (
    <section id="cta" className="py-20 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900 mb-3">
            Be first in the door.
          </h2>
          <p className="text-neutral-500 text-base mb-8 leading-relaxed">
            We&apos;re opening access now. Create your account in under a minute.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
            >
              Create free account
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-neutral-200 bg-white px-6 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-4 text-xs text-neutral-400">
            No credit card required. Cancel any time.
          </p>
        </div>
      </div>
    </section>
  );
}
