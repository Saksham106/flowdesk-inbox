"use client";

import { useEffect, useRef, useState } from "react";
import { buildEmailIframeSrcDoc } from "@/lib/email-iframe";

interface Props {
  html: string;
}

export default function EmailBodyIframe({ html }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function measure() {
      try {
        const doc = iframe?.contentDocument ?? iframe?.contentWindow?.document;
        if (doc?.body) {
          const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
          setHeight(Math.max(80, h + 4));
        }
      } catch {
        // cross-origin guard (shouldn't happen with srcdoc)
      }
    }

    iframe.addEventListener("load", measure);
    // Also observe resize (images loading late, etc.)
    let ro: ResizeObserver | null = null;
    iframe.addEventListener("load", () => {
      try {
        const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (doc?.body) {
          ro = new ResizeObserver(measure);
          ro.observe(doc.body);
        }
      } catch { /* ignore */ }
    });

    return () => {
      iframe.removeEventListener("load", measure);
      ro?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildEmailIframeSrcDoc(html)}
      sandbox="allow-popups allow-same-origin"
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: `${height}px`, border: "none", display: "block", overflow: "hidden" }}
      title="Email content"
      loading="lazy"
    />
  );
}
