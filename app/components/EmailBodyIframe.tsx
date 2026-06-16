"use client";

import { useEffect, useRef, useState } from "react";
import { buildEmailIframeSrcDoc, EMAIL_IFRAME_SANDBOX } from "@/lib/email-iframe";

interface Props {
  html: string;
}

export default function EmailBodyIframe({ html }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let ro: ResizeObserver | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    function measure() {
      try {
        const doc = iframe?.contentDocument ?? iframe?.contentWindow?.document;
        if (!doc?.body) return;
        const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
        const next = Math.max(80, h);
        // Only update when the change is meaningful — prevents ResizeObserver
        // feedback loops where each setHeight triggers another body resize.
        setHeight((prev) => (Math.abs(prev - next) < 8 ? prev : next));
      } catch {
        // cross-origin guard (shouldn't happen with srcdoc)
      }
    }

    function onLoad() {
      measure();
      try {
        const doc = iframe?.contentDocument ?? iframe?.contentWindow?.document;
        if (!doc?.body) return;
        ro = new ResizeObserver(measure);
        ro.observe(doc.body);
        // Disconnect after content settles to prevent long-running layout loops
        // (late-loading images are the main reason to keep observing briefly).
        settleTimer = setTimeout(() => {
          ro?.disconnect();
          ro = null;
        }, 2000);
      } catch { /* ignore */ }
    }

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
      ro?.disconnect();
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildEmailIframeSrcDoc(html)}
      sandbox={EMAIL_IFRAME_SANDBOX}
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: `${height}px`, border: "none", display: "block", overflow: "hidden" }}
      title="Email content"
      loading="lazy"
    />
  );
}
