"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { BrandLockup } from "@/components/brand";
import { acquireBodyScrollLock } from "@/lib/ui/scroll-lock";

type NavigationItem = { href: string; key: string; label: string };

export function MobileNav({
  navigation,
  active,
}: {
  navigation: readonly NavigationItem[];
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const portalReady = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !portalReady) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key === "Tab" && menuRef.current) {
        const focusable = [...menuRef.current.querySelectorAll<HTMLElement>("a,button")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => firstLinkRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [open, portalReady]);

  useEffect(() => {
    if (!open) return;
    return acquireBodyScrollLock();
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const closeAfterNavigation = () => setOpen(false);

  const drawer = open ? (
    <>
      <div className="mobile-menu-backdrop is-open" aria-hidden={!open} onClick={closeMenu} />
      <div className="mobile-menu-layer">
        <div
          id="mobile-primary-menu"
          ref={menuRef}
          className="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Primary navigation menu"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mobile-menu-heading">
            <strong>Navigate</strong>
            <button className="text-button" type="button" onClick={closeMenu}>
              Close menu
            </button>
          </div>
          <div className="mobile-menu-links">
            {navigation.map((item, index) => (
              <Link
                ref={index === 0 ? firstLinkRef : undefined}
                className={item.key === active ? "mobile-nav-link active" : "mobile-nav-link"}
                href={item.href}
                key={item.key}
                aria-current={item.key === active ? "page" : undefined}
                onClick={closeAfterNavigation}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      <div className="mobile-nav">
        <Link className="mobile-nav-brand" href="/" aria-label="The Units Lab home">
          <BrandLockup />
        </Link>
        <button
          ref={menuButtonRef}
          className="menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-primary-menu"
          aria-label="Menu"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="sr-only">{open ? "Close" : "Menu"}</span>
        </button>
      </div>
      {portalReady ? createPortal(drawer, document.body) : null}
    </>
  );
}
