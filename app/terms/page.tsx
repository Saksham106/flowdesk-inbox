import type { Metadata } from "next";
import Link from "next/link";
import LegalPageShell from "@/app/components/landing/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Service — Flowdesk",
  description: "The terms that govern your use of FlowDesk during the beta.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPageShell label="Terms" title="Terms of Service" lastUpdated="July 8, 2026">
      <p>
        These terms govern your use of FlowDesk (&ldquo;FlowDesk&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), an AI email assistant currently offered as a public beta. By creating
        an account or using FlowDesk you agree to these terms and to our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. Beta service</h2>
      <p>
        FlowDesk is in beta. It is provided <strong>free of charge</strong> during the beta
        period. Features may change, break, or be removed, and we may introduce paid plans in the
        future — if we do, we will give you clear notice before you are charged anything.
      </p>

      <h2>2. Your account</h2>
      <p>
        You must provide accurate information and keep your password secure. You are responsible
        for activity under your account. You must be at least 16 years old to use FlowDesk.
      </p>

      <h2>3. What FlowDesk does on your behalf</h2>
      <p>
        By connecting an email account you authorize FlowDesk to read and organize your mail,
        apply and remove labels, create drafts, and — only when you approve a draft or explicitly
        enable auto-send for specific categories — send email from your account. You control how
        much FlowDesk does on its own through the automation level in Settings, and every action
        is recorded in your audit log.
      </p>

      <h2>4. AI-generated content</h2>
      <p>
        FlowDesk uses AI to classify email and draft replies. AI output can be wrong, incomplete,
        or misclassified. You are responsible for reviewing drafts before sending them and for
        any email sent from your account, including via automation features you enable.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to use FlowDesk to:</p>
      <ul>
        <li>Send spam, phishing, or otherwise unlawful or deceptive email.</li>
        <li>Access accounts or data you are not authorized to access.</li>
        <li>Probe, disrupt, or overload the service, or attempt to bypass its security or usage limits.</li>
        <li>Resell or provide the service to third parties without our agreement.</li>
      </ul>

      <h2>6. Your data</h2>
      <p>
        Your email and account data remain yours. How we collect, use, and delete data is
        described in the <Link href="/privacy">Privacy Policy</Link>. You can disconnect a
        connected account at any time, which deletes its synced data from FlowDesk.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        FlowDesk and its software, design, and branding are owned by us. These terms do not grant
        you any rights to them beyond using the service.
      </p>

      <h2>8. Termination</h2>
      <p>
        You can stop using FlowDesk and request account deletion at any time by emailing{" "}
        <a href="mailto:admin@flowdeskinbox.com">admin@flowdeskinbox.com</a>. We may suspend or
        terminate accounts that violate these terms or that put the service or other users at
        risk. During the beta we may also need to suspend the service itself for maintenance or
        significant changes.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        FlowDesk is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>,
        without warranties of any kind, express or implied, including fitness for a particular
        purpose and non-infringement. As a beta product, we do not guarantee uninterrupted or
        error-free operation, or that data will never be lost — keep in mind your email itself
        always remains in your email provider&rsquo;s account.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we are not liable for indirect, incidental,
        special, consequential, or punitive damages, or for lost profits, revenues, or data,
        arising from your use of FlowDesk. Our total liability for any claim relating to the
        service is limited to the amount you paid us in the twelve months before the claim —
        which, during the free beta, is zero.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We may update these terms as the product evolves. If we make material changes we will
        update the date above and notify you by email or in the product. Continuing to use
        FlowDesk after changes take effect means you accept the updated terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        <a href="mailto:admin@flowdeskinbox.com">admin@flowdeskinbox.com</a>
      </p>
    </LegalPageShell>
  );
}
