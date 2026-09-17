import Link from "next/link";

import { BrandLockup } from "@/components/brand";
import { MobileNav } from "@/components/mobile-nav";
import { isAdministrator } from "@/lib/authorization";
import { primaryNavigation } from "@/lib/navigation";

export function AppNav({ active, userId }: { active: string; userId: string }) {
  const navigation = isAdministrator(userId)
    ? [...primaryNavigation, { href: "/admin/settlement-tests", key: "admin", label: "Admin" }]
    : primaryNavigation;

  return (
    <nav className="top-nav" aria-label="Primary navigation">
      <Link className="nav-brand desktop-nav-brand" href="/" aria-label="The Units Lab home">
        <BrandLockup />
      </Link>
      <div className="nav-links">
        {navigation.map((item) => (
          <Link
            className={item.key === active ? "nav-link active" : "nav-link"}
            href={item.href}
            key={item.key}
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <MobileNav navigation={navigation} active={active} />
    </nav>
  );
}
