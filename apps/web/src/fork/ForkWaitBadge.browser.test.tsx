import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

vi.mock(import("../state/primaryEnvironment"), async () => {
  const { Atom } = await import("effect/reactivity");
  return { primaryEnvironmentIdAtom: Atom.make(EnvironmentId.make("local")) };
});
vi.mock(import("./waitStore"), () => ({
  useWaits: () => ({
    now: Date.parse("2026-11-08T12:01:00Z"),
    waits: new Map([
      [
        "copied-thread",
        {
          threadId: "copied-thread",
          kind: "sleep",
          startedAt: "2026-11-08T12:00:00Z",
          deadline: "2026-11-08T12:02:00Z",
        },
      ],
    ]),
  }),
}));

import { ForkWaitBadge } from "./ForkWaitBadge";

it("keeps a local deadline out of a remote copy of the same thread", async () => {
  const badge = (
    environment: string,
    variant: "pie" | "text" = "pie",
    threadId = "copied-thread",
  ) => (
    <ForkWaitBadge
      environmentId={EnvironmentId.make(environment)}
      threadId={threadId}
      variant={variant}
      className="size-4"
      fallback={<span>Original status</span>}
    />
  );
  // The badge contains no navigation or router-dependent hooks.
  await using screen = await render(badge("local"), { router: false });
  await expect.element(screen.getByRole("img")).toBeInTheDocument();
  await expect.element(screen.getByText("Original status")).not.toBeInTheDocument();

  await screen.rerender(badge("remote"));
  await expect.element(screen.getByRole("img")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Original status")).toBeVisible();

  await screen.rerender(badge("remote", "text"));
  await expect.element(screen.getByText("1:00")).not.toBeInTheDocument();
  await screen.rerender(badge("local", "text"));
  await expect.element(screen.getByText("1:00")).toBeVisible();

  await screen.rerender(badge("local", "pie", "no-wait"));
  await expect.element(screen.getByRole("img")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Original status")).toBeVisible();
});
