import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import { expect, it } from "vitest";

it("assigns legacy todos, keeps ownership through edits and undo, and protects prior assignments", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fork-todos-"));
  const data = NodePath.join(dir, "todos.json");
  await NodeFSP.writeFile(
    data,
    JSON.stringify({ todos: [{ id: "legacy", text: "Decide", status: "open" }] }),
  );
  const child = NodeChildProcess.spawn(
    process.execPath,
    ["fork/todos/server.ts", "--port", "0", "--data", data],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = NodeEvents.once(child, "exit");
  const lines = NodeReadline.createInterface({ input: child.stdout });
  try {
    const origin = await Promise.race([
      NodeEvents.once(lines, "line").then(
        ([line]) => /^fork todos on (http:\/\/127\.0\.0\.1:\d+)/.exec(line)?.[1],
      ),
      exited.then(() => undefined),
    ]);
    if (!origin) throw new Error("test todo service failed to start");
    const patch = (body: object) =>
      fetch(`${origin}/api/todos/legacy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const invalid = await patch({ owner: "other" });
    expect(invalid.status).toBe(400);
    await invalid.text();
    const assigned = await patch({ owner: "user", ifUnassigned: true });
    expect(await assigned.json()).toMatchObject({ owner: "user" });

    const conflict = await patch({ owner: "agent", ifUnassigned: true });
    expect(conflict.status).toBe(409);
    await conflict.text();
    expect(await (await patch({ text: "Decide how to proceed" })).json()).toMatchObject({
      owner: "user",
      text: "Decide how to proceed",
    });
    expect(await (await patch({ owner: null })).json()).toMatchObject({ owner: null });
    const undone = await fetch(`${origin}/api/undo`, { method: "POST" });
    expect(await undone.json()).toMatchObject({ todos: [{ id: "legacy", owner: "user" }] });
  } finally {
    lines.close();
    child.kill();
    await exited;
    await NodeFSP.rm(dir, { recursive: true });
  }
});
