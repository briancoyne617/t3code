// Password managers (Bitwarden's inline menu, 1Password, LastPass) pop up on T3 Code's text fields.
// Every field here is a prompt, search or setting, never a login, so mark each one as "not for autofill".
// Password fields (the pairing screen) are left alone so the manager can still fill those.

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
  if (element instanceof HTMLInputElement && !element.getAttribute("autocomplete"))
    element.setAttribute("autocomplete", "off");
}

function scan(root: ParentNode) {
  if (root instanceof Element && root.matches(FIELDS)) mark(root);
  for (const element of root.querySelectorAll(FIELDS)) mark(element);
}

let installed = false;

/** Mark every current and future text field. Safe to call more than once. */
export function installNoAutofill(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
