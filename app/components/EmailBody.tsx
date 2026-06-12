import { renderEmailBodyHtml } from "@/lib/email-body";

interface Props {
  body: string;
}

export default function EmailBody({ body }: Props) {
  const __html = renderEmailBodyHtml(body);
  return (
    <div
      className="email-body text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html }}
    />
  );
}
