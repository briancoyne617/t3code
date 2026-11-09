import { useSyncExternalStore } from "react";

import { serviceUrl } from "./todoStore";

/** One hidden UI element: every element matching `selector` (and `text`, when set) is hidden. */
export interface HiddenRule {
  id: string;
  selector: string;
  text?: string;
  label: string;
  /** Page it was hidden on, to help find it again. */
  page: string;
  createdAt: string;
}

const CACHE_KEY = "fork.hiddenUi";
const HIDDEN_ATTR = "data-fork-hidden";
// The restore list never hides, so a bad rule can always be undone.
export const RESTORE_ATTR = "data-fork-hidden-features";

let rules: ReadonlyArray<HiddenRule> = readCache();
const listeners = new Set<() => void>();

function readCache(): HiddenRule[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as HiddenRule[]) : [];
  } catch {
    return [];
  }
}

function setRules(next: ReadonlyArray<HiddenRule>, save: boolean): void {
  rules = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Private window: the service copy still holds them.
  }
  for (const listener of listeners) listener();
  scheduleApply();
  if (save) {
    void fetch(`${serviceUrl()}/hidden`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: next }),
    }).catch(() => undefined);
  }
}

export function hideElement(rule: Omit<HiddenRule, "id" | "createdAt">): HiddenRule {
  const createdAt = new Date().toISOString();
  const full = { ...rule, id: `${Date.now().toString(36)}-${rules.length}`, createdAt };
  setRules([...rules, full], true);
  return full;
}

export function showRule(id: string): void {
  setRules(
    rules.filter((rule) => rule.id !== id),
    true,
  );
}

export function showAll(): void {
  setRules([], true);
}

export function useHiddenRules(): ReadonlyArray<HiddenRule> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => rules,
  );
}

export function matches(
  rule: { selector: string; text?: string | undefined },
  root: ParentNode = document,
) {
  let found: Element[];
  try {
    found = [...root.querySelectorAll(rule.selector)];
  } catch {
    return [];
  }
  return rule.text === undefined ? found : found.filter((el) => textOf(el) === rule.text);
}

let applyQueued = false;
function scheduleApply(): void {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => {
    applyQueued = false;
    apply();
  });
}

function apply(): void {
  const keep = new Set<Element>();
  for (const rule of rules) {
    for (const el of matches(rule)) {
      if (el.querySelector(`[${RESTORE_ATTR}]`) || el.closest(`[${RESTORE_ATTR}]`)) continue;
      keep.add(el);
      if (el.getAttribute(HIDDEN_ATTR) !== rule.id) el.setAttribute(HIDDEN_ATTR, rule.id);
    }
  }
  for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
    if (!keep.has(el)) el.removeAttribute(HIDDEN_ATTR);
  }
}

const SKIP_DATA = new Set([
  "data-state",
  "data-highlighted",
  "data-disabled",
  "data-active",
  "data-selected",
  "data-open",
  "data-closed",
  "data-pressed",
  "data-checked",
  "data-unchecked",
  "data-side",
  "data-align",
  "data-starting-style",
  "data-ending-style",
  "data-popup-open",
  "data-focused",
  "data-hovered",
  "data-instant",
  HIDDEN_ATTR,
  "data-bwignore",
  "data-1p-ignore",
  "data-lpignore",
  "data-form-type",
]);
// Values that name one thread, run or item would tie the rule to a single chat.
const ID_LIKE = /[0-9a-f]{8}-|[0-9a-f]{12,}|\d{4,}|:r[0-9a-z]+:|^base-ui-|^radix-/i;

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Stable CSS for the element itself, or null when it has nothing stable to go on. */
function ownSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (el.id && !ID_LIKE.test(el.id)) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  for (const attr of el.attributes) {
    if (!attr.name.startsWith("data-") || SKIP_DATA.has(attr.name)) continue;
    if (attr.value === "" || attr.value.length > 60 || ID_LIKE.test(attr.value))
      parts.push(`[${attr.name}]`);
    else parts.push(`[${attr.name}=${quote(attr.value)}]`);
    if (parts.length === 2) break;
  }
  for (const name of ["aria-label", "title", "name", "placeholder", "role"]) {
    const value = el.getAttribute(name);
    if (parts.length >= 2 || !value || value.length > 60 || ID_LIKE.test(value)) continue;
    parts.push(`[${name}=${quote(value)}]`);
  }
  return parts.length > 0 ? `${tag}${parts.join("")}` : null;
}

export interface ElementDescription {
  selector: string;
  text?: string;
  label: string;
  count: number;
}

export function describeElement(el: Element): ElementDescription {
  const own = ownSelector(el);
  const text = textOf(el);
  const shortText = text.length > 0 && text.length <= 40 ? text : undefined;
  let selector = own ?? el.tagName.toLowerCase();
  let ruleText = own ? undefined : shortText;
  // Narrow with the nearest stable ancestor until it is unique (or nothing more helps).
  for (
    let parent = el.parentElement;
    parent && matches({ selector, text: ruleText }).length > 1;
    parent = parent.parentElement
  ) {
    const anchor = ownSelector(parent);
    if (anchor) selector = `${anchor} ${selector}`;
  }
  if (!own && matches({ selector, text: ruleText }).length > 1 && shortText === undefined) {
    // Last resort for a bare wrapper: its position under the parent.
    const index = el.parentElement ? [...el.parentElement.children].indexOf(el) + 1 : 1;
    selector = `${selector}:nth-child(${index})`;
    ruleText = undefined;
  }
  const label =
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    (text ? text.slice(0, 50) : selector);
  return {
    selector,
    ...(ruleText === undefined ? {} : { text: ruleText }),
    label,
    count: matches({ selector, text: ruleText }).length,
  };
}

let installed = false;

export function installHiddenUi(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.textContent = `[${HIDDEN_ATTR}] { display: none !important; }`;
  document.head.append(style);
  new MutationObserver(scheduleApply).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scheduleApply();
  void fetch(`${serviceUrl()}/hidden`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { rules?: HiddenRule[] } | null) => {
      if (!body?.rules) return;
      // A hide made while the service was down lives only in the cache; send it up instead of losing it.
      if (body.rules.length === 0 && rules.length > 0) setRules(rules, true);
      else setRules(body.rules, false);
    })
    .catch(() => undefined);
}
