type StyleSnapshot = {
  htmlOverflow: string;
};

let activeLocks = 0;
let snapshot: StyleSnapshot | null = null;
let lockedScrollY = 0;

/**
 * Keeps modal scroll locking composable when two independent mobile surfaces
 * overlap. Only the last release restores the page state captured by the first
 * lock.
 */
export function acquireBodyScrollLock() {
  if (typeof window === "undefined") return () => undefined;

  if (activeLocks === 0) {
    const html = document.documentElement;
    lockedScrollY = window.scrollY;
    snapshot = {
      htmlOverflow: html.style.overflow,
    };
    html.style.overflow = "hidden";
  }

  activeLocks += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks > 0 || !snapshot) return;

    const html = document.documentElement;
    const previous = snapshot;
    snapshot = null;
    html.style.overflow = previous.htmlOverflow;
    const restoreY = lockedScrollY;
    window.requestAnimationFrame(() => window.scrollTo(0, restoreY));
  };
}
