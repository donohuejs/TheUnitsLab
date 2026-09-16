import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@/lib/ui";

type BrandLogoProps = {
  compact?: boolean;
  className?: string;
};

/** The Units Lab mark: a beaker, a vial-like liquid fill, and a small vapor cue. */
export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    <svg
      className={className}
      width={compact ? 42 : 48}
      height={compact ? 42 : 48}
      viewBox="0 0 48 48"
      role="img"
      aria-label={PRODUCT_NAME}
    >
      <path
        d="M18 6h12M21 6v10L12 33.5A5 5 0 0 0 16.3 41h15.4A5 5 0 0 0 36 33.5L27 16V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.7 30h18.6l2.7 4.2A4.2 4.2 0 0 1 32.4 40H15.6a4.2 4.2 0 0 1-3.6-5.8Z"
        fill="var(--brand-liquid, #f3b84b)"
        opacity=".95"
      />
      <circle cx="24" cy="34.2" r="3.1" fill="var(--brand-coin, #fff7dc)" />
      <path
        d="M23 34.2h2M24 32.7v3"
        stroke="var(--brand-ink, #163331)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M20 11c-2.2 1.4-2.1 3.5-.3 4.7M28.7 10.2c2 1.3 2 3.3.5 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".72"
      />
    </svg>
  );
}

export function BrandLockup({ compact = false, className }: BrandLogoProps) {
  return (
    <span className={className ? `brand-lockup ${className}` : "brand-lockup"}>
      <BrandLogo compact={compact} />
      {!compact ? (
        <span className="brand-copy">
          <span className="brand-name">{PRODUCT_NAME}</span>
          <span className="brand-subtitle">{PRODUCT_SUBTITLE}</span>
        </span>
      ) : null}
    </span>
  );
}
