"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BrandLockup } from "@/components/brand";

type NavigationItem = { href: string; key: string; label: string };

export function MobileNav({
  navigation,
  active,
}: {
  navigation: readonly NavigationItem[];
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const closeAfterNavigation = () => setOpen(false);

  return (
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
      <div
        className={`mobile-menu-backdrop${open ? " is-open" : ""}`}
        aria-hidden={!open}
        hidden={!open}
        onClick={closeMenu}
      >
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
    </div>
  );
}
