import { assert, describe, it } from "vite-plus/test";

import {
  codeBlockFileTarget,
  filePanelPath,
  homeEntriesOutsideProject,
  matchPathListing,
  parsePathQuery,
  projectCoversHome,
  resolvePathQueryDirectory,
} from "./filePickerPaths";

describe("parsePathQuery", () => {
  it("leaves fuzzy queries alone", () => {
    assert.equal(parsePathQuery("readme"), null);
    assert.equal(parsePathQuery("src/app.ts"), null);
    assert.equal(parsePathQuery("~"), null);
  });

  it("splits a typed path into its folder and the name being typed", () => {
    assert.deepEqual(parsePathQuery("/home/brian/.config/hy"), {
      directory: "/home/brian/.config/",
      leaf: "hy",
      line: undefined,
    });
    assert.deepEqual(parsePathQuery("~/"), { directory: "~/", leaf: "", line: undefined });
    assert.deepEqual(parsePathQuery("  ./src/  "), {
      directory: "./src/",
      leaf: "",
      line: undefined,
    });
  });

  it("keeps a :line suffix out of the name", () => {
    assert.deepEqual(parsePathQuery("/repo/src/app.ts:42"), {
      directory: "/repo/src/",
      leaf: "app.ts",
      line: 42,
    });
  });
});

describe("resolvePathQueryDirectory", () => {
  it("resolves explicit relative folders from the project", () => {
    assert.equal(resolvePathQueryDirectory("./src/", "/repo"), "/repo/src/");
    assert.equal(resolvePathQueryDirectory("../other/", "/work/repo/"), "/work/other/");
    assert.equal(resolvePathQueryDirectory("./", "/repo"), "/repo/");
  });

  it("passes host folders through for the server to expand", () => {
    assert.equal(resolvePathQueryDirectory("~/.config/", "/repo"), "~/.config/");
    assert.equal(resolvePathQueryDirectory("/etc/", "/repo"), "/etc/");
  });
});

describe("matchPathListing", () => {
  const entries = [
    { kind: "file", path: "bindings.lua" },
    { kind: "directory", path: "bin" },
    { kind: "file", path: "Binary.md" },
    { kind: "file", path: "rebind.sh" },
    { kind: "file", path: ".bindings-secret" },
    { kind: "directory", path: ".git-hooks" },
    { kind: "file", path: "other.txt" },
  ] as const;

  it("ranks prefix before substring matches and folders before files", () => {
    assert.deepEqual(
      matchPathListing(entries, "bin").map(({ name }) => name),
      ["bin", "Binary.md", "bindings.lua", "rebind.sh"],
    );
  });

  it("puts an exact name first", () => {
    assert.equal(matchPathListing(entries, "bindings.lua")[0]?.name, "bindings.lua");
  });

  it("shows dotfiles only once a dot is typed", () => {
    assert.isFalse(matchPathListing(entries, "").some(({ name }) => name.startsWith(".")));
    assert.deepEqual(
      matchPathListing(entries, ".")
        .slice(0, 2)
        .map(({ name }) => name),
      [".git-hooks", ".bindings-secret"],
    );
  });
});

describe("filePanelPath", () => {
  it("opens project files by their project path so they stay editable", () => {
    assert.equal(
      filePanelPath("/home/b/dev/ide/src/a.ts", "/home/b/dev/ide", "/home/b"),
      "src/a.ts",
    );
    assert.equal(filePanelPath("~/dev/ide/src/a.ts", "/home/b/dev/ide", "/home/b"), "src/a.ts");
  });

  it("opens other files by their host path", () => {
    assert.equal(filePanelPath("~/.config/x.conf", "/repo", "/home/b"), "/home/b/.config/x.conf");
    assert.equal(filePanelPath("~/.config/x.conf", "/repo", null), "~/.config/x.conf");
    assert.equal(filePanelPath("/etc/hosts", "/repo", "/home/b"), "/etc/hosts");
  });

  it("opens the project root as the explorer", () => {
    assert.equal(filePanelPath("/repo/", "/repo", null), ".");
  });
});

describe("home search", () => {
  it("is skipped when the project already contains the home folder", () => {
    assert.isTrue(projectCoversHome("/home/b", "/home/b"));
    assert.isTrue(projectCoversHome("/home/b", "/"));
    assert.isFalse(projectCoversHome("/home/b", "/home/b/dev/ide"));
  });

  it("drops hits the project group already lists", () => {
    const entries = [
      { kind: "file", path: "dev/ide/README.md" },
      { kind: "file", path: "dev/idea/README.md" },
      { kind: "directory", path: "Documents" },
      { kind: "file", path: "notes.md" },
    ] as const;
    assert.deepEqual(
      homeEntriesOutsideProject(entries, "/home/b", "/home/b/dev/ide").map(({ path }) => path),
      ["dev/idea/README.md", "notes.md"],
    );
  });
});

describe("codeBlockFileTarget", () => {
  it("opens an absolute or home path", () => {
    assert.deepEqual(codeBlockFileTarget("/home/b/notes/todo.md\n", "/repo", "/repo"), {
      panelPath: "/home/b/notes/todo.md",
    });
    assert.deepEqual(codeBlockFileTarget("~/.config/hypr/bindings.lua:12", "/repo", "/repo"), {
      panelPath: "~/.config/hypr/bindings.lua",
      line: 12,
    });
  });

  it("opens project paths relative to the project", () => {
    assert.deepEqual(codeBlockFileTarget("/repo/src/app.ts", "/repo", "/repo"), {
      panelPath: "src/app.ts",
    });
    assert.deepEqual(codeBlockFileTarget("apps/web/src/main.tsx", "/repo", "/repo"), {
      panelPath: "apps/web/src/main.tsx",
    });
  });

  it("ignores commands, refs, URLs and multi-line blocks", () => {
    assert.isNull(codeBlockFileTarget("ls -la /tmp", "/repo", "/repo"));
    assert.isNull(codeBlockFileTarget("origin/custom", "/repo", "/repo"));
    assert.isNull(codeBlockFileTarget("https://example.com/a.md", "/repo", "/repo"));
    assert.isNull(codeBlockFileTarget("/a/b.ts\n/c/d.ts", "/repo", "/repo"));
    assert.isNull(codeBlockFileTarget("src/app.ts", undefined, undefined));
  });
});
