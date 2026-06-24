# Email Remote-Image Privacy Design

> Point-in-time design record. Verify current behavior in code and [`../CURRENT_STATE.md`](../CURRENT_STATE.md).

## Goal

Prevent HTML email from disclosing an email open to remote servers by default while preserving readable email layout and offering an explicit, per-message way to load newsletter images.

## Current Problem

`sanitizeEmailHtmlForIframe` permits `http:` and `https:` image sources, and `buildEmailIframeSrcDoc` does not inject a Content Security Policy. Rendering a message can therefore fetch tracking pixels, CSS background images, remote stylesheets, or fonts without user consent. The iframe sandbox prevents scripts but does not prevent these network requests.

## Design

### Sanitized variants

The server-rendered `EmailBody` component will create two sanitized variants from the original HTML:

- A privacy-safe variant removes remote `http:` and `https:` image sources. This is the default rendered document.
- An opt-in variant preserves HTTPS image sources for users who choose **Load images**. HTTP image sources remain blocked because they are insecure and commonly blocked as mixed content in production.

Both variants continue to remove scripts, event handlers, JavaScript URLs, forms, embedded frames, and other dangerous content. The raw message HTML is never passed to the client.

### Network containment

`buildEmailIframeSrcDoc` will inject a restrictive CSP. The default policy denies all network access and permits only inline email styles plus non-network image schemes needed for embedded content. The opt-in policy permits HTTPS images but continues to deny scripts, connections, frames, forms, remote stylesheets, media, and fonts.

The iframe will also use `referrerPolicy="no-referrer"`. Existing anchor transforms continue to force `rel="noopener noreferrer"` and open links outside the iframe sandbox.

### User experience

When an HTML email contains remote images, `EmailBodyIframe` displays a compact notice above the message: **Remote images blocked for privacy**, with a **Load images** button. Choosing it affects only that mounted message. The setting is not persisted across messages or sessions, avoiding silent future tracking.

Messages without remote images show no notice. Blocked images retain their dimensions, alt text, and surrounding table layout where those attributes are present, so newsletter text remains readable.

## Error Handling

Missing, malformed, HTTP, or disallowed image sources remain absent after sanitization. Opting in does not weaken the iframe sandbox or allow scripts. Image load failures remain browser-level failures and do not trigger retries or proxy requests.

## Testing

- Sanitizer tests prove remote sources are removed by default and only HTTPS sources survive explicit opt-in.
- Iframe tests prove the default CSP denies remote images and the opt-in CSP permits only HTTPS images.
- Component-level source coverage proves the privacy notice, opt-in control, and `no-referrer` iframe policy are wired.
- Existing sanitizer, iframe layout, typecheck, lint, full test, and production build checks must remain green.

## Documentation

Add user-facing privacy documentation explaining that remote images are blocked by default, that loading images can notify senders, and that the choice is per message.

## Non-Goals

- A server-side image proxy, which requires SSRF protection, content limits, caching, and abuse controls.
- A tracker-domain blocklist, which cannot cover sender-specific or newly created tracking hosts.
- Persistent sender allowlists or account-level preferences.
- CID attachment resolution, which remains tracked separately in issue #40.
