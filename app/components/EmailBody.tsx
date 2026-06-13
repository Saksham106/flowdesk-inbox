import { isHtmlBody, sanitizeEmailHtmlForIframe, linkifyText } from "@/lib/email-body";
import EmailBodyIframe from "@/app/components/EmailBodyIframe";

interface Props {
  body: string;
}

export default function EmailBody({ body }: Props) {
  if (isHtmlBody(body)) {
    const sanitized = sanitizeEmailHtmlForIframe(body);
    return <EmailBodyIframe html={sanitized} />;
  }

  // Plain text: linkify URLs and convert newlines to <br>
  return (
    <div
      className="email-body-text text-sm leading-relaxed text-slate-900"
      dangerouslySetInnerHTML={{ __html: linkifyText(body) }}
    />
  );
}
