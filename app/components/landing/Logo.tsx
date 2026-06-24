const ICON_SRC = "/images/landing/logo-icon.svg";
const WORDMARK_SRC = "/images/landing/logo-wordmark.svg";

export default function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const iconSize = size === "sm" ? 22 : 27;
  const wordmarkH = size === "sm" ? 15 : 18.81;
  const wordmarkW = size === "sm" ? 80 : 100.273;

  return (
    <a href="/" className="flex items-center gap-1 shrink-0">
      <div className="relative shrink-0" style={{ width: iconSize, height: iconSize }}>
        <img
          alt=""
          src={ICON_SRC}
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
      <div className="relative shrink-0" style={{ width: wordmarkW, height: wordmarkH }}>
        <img
          alt="Flowdesk"
          src={WORDMARK_SRC}
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
    </a>
  );
}
