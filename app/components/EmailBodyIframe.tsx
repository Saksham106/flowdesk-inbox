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
        // Prefer body.scrollHeight: documentElement.scrollHeight returns the current viewport
        // height (not content height) when `html { overflow: hidden }` is set in the injected CSS.
        const h = doc.body.scrollHeight || doc.documentElement.scrollHeight;
        // +16px buffer prevents hairline clips at the article's overflow:hidden rounded corners.
        const next = Math.max(80, h + 16);
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

        // Re-measure after remote images load — newsletters can have many images that
        // arrive after the initial load event, expanding the body well beyond the first measurement.
        const pending = Array.from(doc.images).filter((img) => !img.complete);
        if (pending.length > 0) {
          void Promise.all(
            pending.map(
              (img) => new Promise<void>((res) => {
                img.addEventListener("load", () => res(), { once: true });
                img.addEventListener("error", () => res(), { once: true });
              })
            )
          ).then(measure);
        }

        // Re-measure when web fonts finish loading
        void doc.fonts?.ready?.then(measure);

        ro = new ResizeObserver(measure);
        ro.observe(doc.body);
        settleTimer = setTimeout(() => {
          ro?.disconnect();
          ro = null;
        }, 3000);
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
