export async function collectBrowsePaneDiagnostics(page) {
  return page.evaluate(() => {
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: typeof element.className === "string" ? element.className : null,
        rect: {
          top: Number(rect.top.toFixed(2)),
          bottom: Number(rect.bottom.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          left: Number(rect.left.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
        },
        computed: {
          display: style.display,
          position: style.position,
          overflow: style.overflow,
          overflowY: style.overflowY,
          height: style.height,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
          flex: style.flex,
          flexDirection: style.flexDirection,
          gridTemplateRows: style.gridTemplateRows,
        },
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
      };
    };

    const nearestOverflowAncestor = (element) => {
      let current = element.parentElement;
      while (current) {
        const style = getComputedStyle(current);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
          return describe(current);
        }
        current = current.parentElement;
      }
      return null;
    };

    const pane = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const detail = describe(element);
      return {
        ...detail,
        scrollTop: Number(element.scrollTop.toFixed(2)),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };

    const ancestorChain = (element) => {
      const chain = [];
      let current = element;
      while (current && chain.length < 12) {
        const detail = describe(current);
        chain.push({
          tag: detail.tag,
          id: detail.id,
          className: detail.className,
          rect: detail.rect,
          computed: detail.computed,
        });
        current = current.parentElement;
      }
      return chain;
    };

    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const viewportBottom = window.innerHeight + 4;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (!visible(element)) return false;
        const style = getComputedStyle(element);
        if (style.position === "fixed") return false;
        return element.getBoundingClientRect().bottom > viewportBottom;
      })
      .map((element) => {
        const detail = describe(element);
        return {
          ...detail,
          documentFlowBottom: Number(
            (element.getBoundingClientRect().bottom + window.scrollY).toFixed(2),
          ),
          nearestOverflowAncestor: nearestOverflowAncestor(element),
          ancestors: ancestorChain(element),
        };
      })
      .sort((left, right) => right.rect.bottom - left.rect.bottom)
      .slice(0, 20);

    const root = document.documentElement;
    const body = document.body;
    const shell = document.querySelector(".browse-shell");
    const workspace = document.querySelector(".browse-master-detail-layout");
    return {
      viewport: {
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
      },
      document: {
        scrollY: window.scrollY,
        documentElementClientHeight: root.clientHeight,
        documentElementScrollHeight: root.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
      },
      rootScrollLock: {
        htmlClassName: root.className,
        htmlOverflowY: getComputedStyle(root).overflowY,
        htmlHeight: getComputedStyle(root).height,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyHeight: getComputedStyle(body).height,
      },
      breakpoints: {
        desktopWorkspace: window.matchMedia("(min-width: 980px)").matches,
        legacyWideWorkspace: window.matchMedia("(min-width: 1240px)").matches,
        tabletFallback: window.matchMedia("(min-width: 761px) and (max-width: 979px)").matches,
      },
      shell: shell ? describe(shell) : null,
      workspace: workspace ? describe(workspace) : null,
      panes: {
        games: pane(".browse-games-rail"),
        markets: pane(".browse-market-detail"),
        betSlip: pane("#browse-bet-slip-target"),
      },
      ancestorChains: {
        shell: shell ? ancestorChain(shell) : [],
        workspace: workspace ? ancestorChain(workspace) : [],
      },
      bottomExtendingElements: offenders,
    };
  });
}

export function formatBrowsePaneDiagnostics(metrics) {
  return JSON.stringify(metrics, null, 2);
}
