const ICON_SRC = "https://www.figma.com/api/mcp/asset/260bcc94-4dd6-45f4-9878-c959d8dc68e3";
const WORDMARK_SRC = "https://www.figma.com/api/mcp/asset/f3ff3059-3b65-4d83-8143-b5f4c403381a";

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
