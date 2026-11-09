import { describe, expect, it } from "vitest";

import { currentForkInstance, forkInstanceUrl } from "./forkInstance";

describe("currentForkInstance", () => {
  it("reads the instance from the port", () => {
    expect(currentForkInstance({ port: "5833" })).toBe("dev");
    expect(currentForkInstance({ port: "3773" })).toBe("stable");
  });
});

describe("forkInstanceUrl", () => {
  it("uses the README hostnames on this machine so cookies stay apart", () => {
    const local = { hostname: "localhost", protocol: "http:" };
    expect(forkInstanceUrl("dev", local)).toBe("http://127.0.0.1:5833/");
    expect(forkInstanceUrl("stable", { ...local, hostname: "127.0.0.1" })).toBe(
      "http://localhost:3773/",
    );
  });

  it("keeps a LAN hostname and swaps the port", () => {
    const lan = { hostname: "192.168.1.20", protocol: "http:" };
    expect(forkInstanceUrl("dev", lan)).toBe("http://192.168.1.20:5833/");
    expect(forkInstanceUrl("stable", lan)).toBe("http://192.168.1.20:3773/");
  });
});
