import type { Metadata } from "next";
import LegalPageShell from "@/app/components/landing/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Flowdesk",
  description: "How FlowDesk collects, uses, protects, and deletes your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell label="Privacy" title="Privacy Policy" lastUpdated="July 8, 2026">
      <p>
        FlowDesk (&ldquo;FlowDesk&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an AI email
        assistant that connects to your Gmail account, organizes your inbox with labels, and
        drafts replies for your review. This policy describes exactly what data FlowDesk
        collects, how it is used, who it is shared with, and how you can delete it. Questions:{" "}
        <a href="mailto:admin@flowdeskinbox.com">admin@flowdeskinbox.com</a>.
      </p>

      <h2>Information we collect</h2>

      <h3>Account information</h3>
      <p>
        When you create a FlowDesk account we store your email address and a hashed password.
        We never see or store your Google account password.
      </p>

      <h3>Gmail data (with your permission)</h3>
      <p>
        If you connect Gmail, you grant FlowDesk access through Google OAuth with these scopes:
      </p>
      <ul>
        <li>
          <strong>gmail.readonly</strong> — to read and sync your inbox messages so FlowDesk can
          classify and organize them.
        </li>
        <li>
          <strong>gmail.modify</strong> — to apply and remove labels, archive, and mark messages
          read/unread, and to create and withdraw drafts in your Gmail.
        </li>
        <li>
          <strong>gmail.send</strong> — to send replies, only when you approve a draft or have
          explicitly enabled auto-send for specific categories.
        </li>
        <li>
          <strong>userinfo.email / userinfo.profile</strong> — to identify which Google account
          is connected.
        </li>
      </ul>
      <p>From your Gmail we store:</p>
      <ul>
        <li>Email messages you have synced — sender, recipients, subject, body, and thread metadata.</li>
        <li>Classification results (e.g. &ldquo;Needs Reply&rdquo;, &ldquo;Newsletter&rdquo;) and the reasoning behind them.</li>
        <li>Drafts FlowDesk creates and replies you send through FlowDesk.</li>
        <li>
          Audit logs — a record of every action FlowDesk takes on your mail (labels applied,
          drafts created, messages sent), so you can always see what it did and why.
        </li>
        <li>
          OAuth tokens, stored <strong>encrypted at rest</strong>. Access tokens are refreshed
          automatically; we never store your Google password.
        </li>
      </ul>
      <p>What we do <strong>not</strong> do with your email:</p>
      <ul>
        <li>We do not sell your data, ever, to anyone.</li>
        <li>We do not use your email content for advertising.</li>
        <li>We do not use your email content to train our own or third-party generalized AI/ML models.</li>
        <li>
          Remote images in emails are not fetched by default when you view a message in FlowDesk —
          you choose per message whether to load them.
        </li>
        <li>
          No humans at FlowDesk read your email, except with your explicit permission (e.g. a
          support request), when necessary for security or abuse investigation, or where required
          by law.
        </li>
      </ul>

      <h3>Other connections (optional)</h3>
      <p>
        FlowDesk can also connect Microsoft Outlook (email sync via Microsoft Graph), Google
        Calendar (events and availability), and Google Drive. All connection tokens are stored
        encrypted at rest and each connection is optional. Google Drive content is not currently
        used in drafting.
      </p>

      <h2>How we use your data</h2>
      <p>Your data is used only to provide FlowDesk&rsquo;s user-facing features to you:</p>
      <ul>
        <li>Classifying and labeling your email, in the app and natively in Gmail.</li>
        <li>Drafting replies in your writing style for your review.</li>
        <li>Tracking follow-ups and things you are waiting on.</li>
        <li>Showing you a complete audit history of what the assistant did.</li>
      </ul>

      <h2>Google API Services — Limited Use disclosure</h2>
      <p>
        FlowDesk&rsquo;s use and transfer to any other app of information received from Google
        APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Specifically:
      </p>
      <ul>
        <li>
          We only use Google user data to provide and improve the user-facing features described
          above.
        </li>
        <li>
          We do not transfer Google user data to third parties except as necessary to provide
          those features (see &ldquo;Service providers&rdquo; below), to comply with applicable
          law, or as part of a merger or acquisition with prior notice to you.
        </li>
        <li>We do not use Google user data for advertising.</li>
        <li>
          We do not use Google user data to train generalized artificial intelligence or machine
          learning models.
        </li>
        <li>
          Humans do not read Google user data except with your explicit permission, for security
          or abuse purposes, to comply with law, or when aggregated and anonymized.
        </li>
      </ul>

      <h2>Service providers (subprocessors)</h2>
      <ul>
        <li>
          <strong>OpenRouter and its underlying model providers</strong> — AI processing.
          Portions of email content are routed through OpenRouter to the underlying AI model
          providers it connects to, in order to classify messages and generate reply drafts.
          Under OpenRouter&rsquo;s terms, data sent via the API is not used to train the
          underlying providers&rsquo; models.
        </li>
        <li>
          <strong>Cloud hosting and database infrastructure</strong> — FlowDesk runs on managed
          cloud infrastructure (currently Railway), where your data is stored and processed.
        </li>
        <li>
          <strong>Google and Microsoft APIs</strong> — used to read from and write to the
          accounts you connect.
        </li>
      </ul>

      <h2>Data retention and deletion</h2>
      <ul>
        <li>
          <strong>Disconnecting Gmail</strong> (Settings → Connectors) permanently deletes the
          synced email messages, threads, classifications, drafts, and sync state for that
          account from FlowDesk&rsquo;s database. Records of actions already taken (audit log
          entries) may be retained until your account is deleted.
        </li>
        <li>
          Labels and drafts FlowDesk created inside your Gmail remain in your Gmail — they are
          yours and you can remove them there.
        </li>
        <li>
          <strong>Deleting your account</strong>: email{" "}
          <a href="mailto:admin@flowdeskinbox.com">admin@flowdeskinbox.com</a> and we will delete
          your account and all associated data. Self-serve account deletion is coming during the
          beta.
        </li>
        <li>
          You can also revoke FlowDesk&rsquo;s access to your Google account at any time at{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </li>
      </ul>

      <h2>Security</h2>
      <ul>
        <li>OAuth tokens and sync cursors are encrypted at rest.</li>
        <li>All data in transit is protected with TLS.</li>
        <li>Every account&rsquo;s data is isolated — queries are scoped to your account.</li>
        <li>
          Email HTML is sanitized and rendered in a sandboxed frame; remote content is blocked by
          default.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        FlowDesk is not directed to children and is not intended for use by anyone under 16. We
        do not knowingly collect data from children.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        FlowDesk is in beta and this policy will evolve. If we make material changes, we will
        update the date above and notify you by email or in the product before the changes take
        effect.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:admin@flowdeskinbox.com">admin@flowdeskinbox.com</a>
      </p>
    </LegalPageShell>
  );
}
