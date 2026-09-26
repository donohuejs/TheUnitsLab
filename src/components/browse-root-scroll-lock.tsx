"use client";

import { useEffect } from "react";

const BROWSE_ROUTE_CLASS = "browse-route-active";

export function BrowseRootScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(BROWSE_ROUTE_CLASS);
    window.scrollTo(0, 0);

    return () => {
      root.classList.remove(BROWSE_ROUTE_CLASS);
    };
  }, []);

  return null;
}
