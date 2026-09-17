import Image from "next/image";

import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@/lib/ui";

type BrandLogoProps = {
  compact?: boolean;
  className?: string;
};

type BrandLockupProps = BrandLogoProps & {
  variant?: "nav" | "home";
};

const FULL_LOGO_PATH = "/brand/the-units-lab-logo.png";
const COMPACT_MARK_PATH = "/brand/the-units-lab-mark.png";

/** Uses the approved raster brand assets without recreating or approximating them. */
export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    <Image
      className={className}
      src={compact ? COMPACT_MARK_PATH : FULL_LOGO_PATH}
      alt={compact ? PRODUCT_NAME : `${PRODUCT_NAME} — ${PRODUCT_SUBTITLE}`}
      width={compact ? 1254 : 1448}
      height={compact ? 1254 : 1086}
      priority={!compact}
    />
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
    </span>
  );
}
