// Alt+right-click any element to hide it: outline it, ↑/↓ to pick a bigger or smaller piece, Enter hides.
import { toastManager } from "../components/ui/toast";
import { describeElement, hideElement, RESTORE_ATTR, showRule } from "./hiddenUi";

const BUTTON =
  "rounded border border-border px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground";

let session: { stack: Element[]; index: number; teardown: () => void } | null = null;

function isPickable(el: Element): boolean {
  return (
    el !== document.body &&
    el !== document.documentElement &&
    el.id !== "root" &&
    !el.closest("[data-fork-hide-picker]") &&
    !el.closest(`[${RESTORE_ATTR}]`)
  );
}

function start(target: Element): void {
  session?.teardown();
  // Candidates from the clicked element outward; ↑ walks out to bigger pieces.
  const stack: Element[] = [];
  for (let el: Element | null = target; el; el = el.parentElement)
    if (isPickable(el)) stack.push(el);
  if (stack.length === 0) return;

  const outline = document.createElement("div");
  outline.dataset.forkHidePicker = "";
  outline.className =
    "pointer-events-none fixed z-[2147483646] rounded-sm outline-2 outline-dashed outline-destructive bg-destructive/10";
  const bar = document.createElement("div");
  bar.dataset.forkHidePicker = "";
  bar.className =
    "fixed z-[2147483647] flex max-w-[min(32rem,90vw)] flex-col gap-1 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg";
  document.body.append(outline, bar);

  const render = () => {
    if (!session) return;
    const el = session.stack[session.index]!;
    const box = el.getBoundingClientRect();
    Object.assign(outline.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    const info = describeElement(el);
    bar.replaceChildren();
    const title = document.createElement("div");
    title.className = "font-medium";
    title.textContent = `Hide “${info.label}”${info.count > 1 ? ` (${info.count} like it)` : ""}`;
    const code = document.createElement("div");
    code.className = "truncate font-mono text-2xs text-muted-foreground";
    code.textContent = info.selector + (info.text ? `  text="${info.text}"` : "");
    const row = document.createElement("div");
    row.className = "flex flex-wrap items-center gap-1";
    const button = (label: string, onClick: () => void, disabled = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = BUTTON;
      b.textContent = label;
      b.disabled = disabled;
      if (disabled) b.classList.add("opacity-50");
      b.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      row.append(b);
    };
    button("↑ Bigger", () => move(1), session.index >= session.stack.length - 1);
    button("↓ Smaller", () => move(-1), session.index === 0);
    button("Hide (Enter)", hide);
    button("Cancel (Esc)", () => session?.teardown());
    bar.append(title, code, row);
    const top =
      box.bottom + 8 + 90 < window.innerHeight ? box.bottom + 8 : Math.max(8, box.top - 98);
    Object.assign(bar.style, {
      left: `${Math.min(Math.max(8, box.left), window.innerWidth - 320)}px`,
      top: `${top}px`,
    });
  };

  const move = (step: number) => {
    if (!session) return;
    session.index = Math.min(session.stack.length - 1, Math.max(0, session.index + step));
    render();
  };

  const hide = () => {
    if (!session) return;
    const info = describeElement(session.stack[session.index]!);
    session.teardown();
    const rule = hideElement({
      selector: info.selector,
      ...(info.text === undefined ? {} : { text: info.text }),
      label: info.label,
      page: window.location.pathname,
    });
    toastManager.add({
      type: "success",
      title: `Hid “${rule.label}”`,
      description: "Bring it back in Settings → Appearance → Hidden features.",
      actionProps: { children: "Undo", onClick: () => showRule(rule.id) },
    });
  };

  const onKey = (event: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      Escape: () => session?.teardown(),
      Enter: hide,
      ArrowUp: () => move(1),
      ArrowDown: () => move(-1),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-fork-hide-picker]")) return;
    session?.teardown();
  };
  const onScroll = () => render();

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  session = {
    stack,
    index: 0,
    teardown: () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      outline.remove();
      bar.remove();
      session = null;
    },
  };
  render();
}

let installed = false;

export function installHidePicker(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      start(event.target);
    },
    true,
  );
}
