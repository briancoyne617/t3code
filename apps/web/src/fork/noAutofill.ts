// Password managers (Bitwarden, 1Password, LastPass) pop up on T3 Code's fields; none of them is a login.
// Mark every field "not for autofill", leaving password fields (pairing) alone. Bitwarden honours
// data-bwignore only behind an opt-in setting but always skips type="search", so text inputs become search.

const MARKS: ReadonlyArray<readonly [string, string]> = [
  ["data-bwignore", "true"], // Bitwarden
  ["data-1p-ignore", "true"], // 1Password
  ["data-lpignore", "true"], // LastPass
  ["data-form-type", "other"], // Dashlane
];

const FIELDS = "input:not([type=password]):not([type=hidden]), textarea, [contenteditable=true]";

function mark(element: Element) {
  for (const [name, value] of MARKS) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  if (!(element instanceof HTMLInputElement)) return;
  if (!element.getAttribute("autocomplete")) element.setAttribute("autocomplete", "off");
  const type = element.getAttribute("type");
  if (type === null || type === "text") element.setAttribute("type", "search");
}

function scan(root: ParentNode) {
  if (root instanceof Element && root.matches(FIELDS)) mark(root);
  for (const element of root.querySelectorAll(FIELDS)) mark(element);
}

/** Spread onto fork inputs so the marks exist before an autoFocus fires (the observer runs a tick late). */
export const NO_AUTOFILL = Object.fromEntries([...MARKS, ["autoComplete", "off"]]);

let installed = false;

/** Mark every current and future text field. Safe to call more than once. */
export function installNoAutofill(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.textContent =
    "input[type=search]::-webkit-search-cancel-button, input[type=search]::-webkit-search-decoration { appearance: none; }";
  document.head.append(style);
  scan(document);
  // Capture phase runs before a password manager's own focus handler on the field.
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof Element && event.target.matches(FIELDS)) mark(event.target);
    },
    true,
  );
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
