import Link from "next/link";

import { isAdministrator } from "@/lib/authorization";
import { primaryNavigation } from "@/lib/navigation";
import { PRODUCT_NAME } from "@/lib/ui";

export function AppNav({ active, userId }: { active: string; userId: string }) {
  const navigation = isAdministrator(userId)
    ? [...primaryNavigation, { href: "/admin/api-usage", key: "admin", label: "Admin" }]
    : primaryNavigation;

  return (
    <nav className="top-nav" aria-label="Primary navigation">
      <Link className="nav-brand" href="/" aria-label={`${PRODUCT_NAME} home`}>
        The Units <span>Lab</span>
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
    </nav>
  );
}
