import { expect, it } from "vite-plus/test";

import { describeElement, matches } from "./hiddenUi";

function mount(html: string): Disposable {
  document.body.innerHTML = html;
  return { [Symbol.dispose]: () => document.body.replaceChildren() };
}

it("uses stable attributes and skips state and per-thread values", () => {
  using _dom = mount(
    `<button aria-label="Open terminal" data-state="closed" data-thread-id="3f2a9c1e-77aa">x</button>`,
  );
  const info = describeElement(document.querySelector("button")!);
  expect(info.selector).toBe('button[data-thread-id][aria-label="Open terminal"]');
  expect(info.count).toBe(1);
});

it("narrows a repeated element with its nearest stable ancestor", () => {
  using _dom = mount(`
    <nav data-sidebar-footer><button title="Settings">s</button></nav>
    <header data-chat-header><button title="Settings">s</button></header>`);
  const info = describeElement(document.querySelector("[data-chat-header] button")!);
  expect(info.selector).toBe('header[data-chat-header] button[title="Settings"]');
  expect(info.count).toBe(1);
});

it("falls back to short text for bare elements, and the rule finds it again after a re-render", () => {
  using _dom = mount(`<div data-panel><span>Usage</span><span>Other</span></div>`);
  const info = describeElement(document.querySelectorAll("span")[0]!);
  expect(info.text).toBe("Usage");
  using _again = mount(`<div data-panel><span>Other</span><span>Usage</span></div>`);
  expect(matches(info).map((el) => el.textContent)).toEqual(["Usage"]);
});
