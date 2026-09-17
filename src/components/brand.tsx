import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@/lib/ui";

type BrandLogoProps = {
  compact?: boolean;
  className?: string;
};

type BrandLockupProps = BrandLogoProps & {
  variant?: "nav" | "home";
};

/** A reusable laboratory-glass mark with a Vial cue in the liquid and rising vapor. */
export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    <svg
      className={className}
      width={compact ? 44 : 72}
      height={compact ? 44 : 72}
      viewBox="0 0 72 72"
      role="img"
      aria-label={PRODUCT_NAME}
    >
      <path
        d="M27 8h18M31 8v17L17.2 53.8A7.2 7.2 0 0 0 23.4 64h25.2a7.2 7.2 0 0 0 6.2-10.2L41 25V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21.8 46.5h28.4l4.1 7.5A6.7 6.7 0 0 1 48.5 64h-25a6.7 6.7 0 0 1-5.8-10Z"
        fill="var(--brand-liquid, #f3b84b)"
        opacity=".95"
      />
      <path
        d="M21.8 46.5h28.4"
        fill="none"
        stroke="var(--brand-ink, #163331)"
        strokeWidth="1.6"
        opacity=".55"
      />
      <circle cx="36" cy="54.5" r="6.2" fill="var(--brand-coin, #fff7dc)" />
      <text
        x="36"
        y="57.3"
        textAnchor="middle"
        fill="var(--brand-ink, #163331)"
        fontSize="8"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        $
      </text>
      <path
        d="M50 34h5M51 39h4M53 44h3"
        stroke="var(--brand-ink, #163331)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".55"
      />
      <path
        d="M28 20c-3.6-2.2-3.7-5.3-.8-7.3M39 17c3.1-2.2 3.1-5 .6-7.2M47 20c3.3-2.3 3.2-5 .8-7.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity=".72"
      />
    </svg>
  );
}

export function BrandLockup({ compact = false, className, variant = "nav" }: BrandLockupProps) {
  return (
    <span
      className={
        className ? `brand-lockup brand-${variant} ${className}` : `brand-lockup brand-${variant}`
      }
    >
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
