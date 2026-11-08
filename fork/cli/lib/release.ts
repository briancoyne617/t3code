import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import {
  act,
  capture,
  DRY_RUN,
  ForkError,
  type ForkConfig,
  log,
  NODE_BIN,
  P,
  readJson,
  readPointer,
  runStep,
  timestamp,
  VP_BIN,
  warn,
  writeJsonAtomic,
} from "./core.ts";

export function git(cwd: string, args: ReadonlyArray<string>, allowFail = false) {
  return capture("git", ["-C", cwd, ...args], { allowFail });
}

export function revParse(cwd: string, ref: string): string | undefined {
  const out = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], true);
  return out.code === 0 ? out.stdout : undefined;
}

export function currentBranch(cwd: string): string {
  return git(cwd, ["branch", "--show-current"]).stdout;
}

export function isClean(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain", "--untracked-files=normal"]).stdout === "";
}

export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], true).code === 0;
}

/** Upstream ref inside the stable repo (main mirrors upstream) or inside a local clone of it. */
export function upstreamRef(cwd: string): string {
  for (const ref of ["refs/remotes/upstream/main", "refs/heads/main", "refs/remotes/origin/main"]) {
    if (revParse(cwd, ref)) return ref;
  }
  throw new ForkError(`No upstream main ref found in ${cwd}`);
}

export function upstreamBase(cwd: string, head = "HEAD"): string {
  return git(cwd, ["merge-base", head, upstreamRef(cwd)]).stdout;
}

/** Latest plain stable tag (vX.Y.Z without a suffix) reachable from upstream main. */
export function latestStableTag(cwd: string): string {
  const out = git(cwd, [
    "tag",
    "--merged",
    upstreamRef(cwd),
    "--sort=-v:refname",
    "--list",
    "v*.*.*",
  ]).stdout;
  const tag = out.split("\n").find((name) => /^v\d+\.\d+\.\d+$/.test(name));
  if (!tag) throw new ForkError("No stable upstream tag found");
  return tag;
}

/** Local clone sharing objects with the repo; skips the 250 MB of vendored read-only references. */
export function makeClone(repo: string, dir: string, checkout: string): void {
  git(repo, ["clone", "--quiet", "--local", "--no-checkout", repo, dir]);
  git(dir, ["config", "core.sparseCheckout", "true"]);
  git(dir, ["sparse-checkout", "set", "--no-cone", "/*", "!/.repos/"]);
  for (const key of ["user.name", "user.email"]) {
    const value = git(repo, ["config", key], true).stdout;
    if (value) git(dir, ["config", key, value]);
  }
  git(dir, ["config", "rerere.enabled", "true"]);
  git(dir, ["config", "merge.conflictStyle", "diff3"]);
  git(dir, ["checkout", "--quiet", checkout]);
}

export interface Manifest {
  id: string;
  sha: string;
  branch: string;
  createdAt: string;
  nodeVersion: string;
  serverVersion: string;
  serverFingerprint: string;
  clientFingerprint: string;
  tests: string;
}

export function releaseDir(id: string): string {
  return NodePath.join(P.releases, id);
}

export function readManifest(id: string): Manifest | undefined {
  return readJson<Manifest>(NodePath.join(releaseDir(id), "manifest.json"));
}

export function newReleaseId(sha: string): string {
  return `${timestamp()}-${sha.slice(0, 8)}`;
}

/** Install and build a release from a prepared clone (`<release>/src`). */
export function installRelease(dir: string): void {
  runStep("install dependencies (vp i --frozen-lockfile)", VP_BIN, ["i", "--frozen-lockfile"], {
    cwd: NodePath.join(dir, "src"),
  });
}

/**
 * Upstream's release workflow writes the real version into package.json at build time; the tagged
 * source still says the previous one. Do the same so the server reports its upstream base (e.g. 0.1.7).
 */
export function stampVersion(dir: string): string | undefined {
  const src = NodePath.join(dir, "src");
  const tag = git(
    src,
    [
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v[0-9]*.[0-9]*.[0-9]*",
      "--exclude",
      "*-*",
      "HEAD",
    ],
    true,
  ).stdout;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return undefined;
  const version = tag.slice(1);
  runStep(
    `stamp version ${version} (upstream base ${tag})`,
    NODE_BIN,
    ["scripts/update-release-package-versions.ts", version],
    { cwd: src },
  );
  return version;
}

export function buildRelease(dir: string): void {
  const src = NodePath.join(dir, "src");
  runStep(
    "build web + server (vp run --filter t3 build)",
    VP_BIN,
    ["run", "--filter", "t3", "build"],
    { cwd: src },
  );
  if (!DRY_RUN && !NodeFS.existsSync(NodePath.join(src, "apps/server/dist/bin.mjs"))) {
    throw new ForkError(`Build finished but ${src}/apps/server/dist/bin.mjs is missing`);
  }
}

/**
 * Seal a built release:
 * - bin/node: a hard link to the Node it was built with, so a vp upgrade never changes a release
 * - web/: the UI the stable server serves; previous hashed assets are kept so open tabs can still lazy-load
 * - apps/server/dist/client becomes a link to ~/.t3-fork/client-current, so the UI can be swapped live
 */
export function sealRelease(
  dir: string,
  info: { sha: string; branch: string; tests: string; carryFrom?: string },
): Manifest {
  const src = NodePath.join(dir, "src");
  const id = NodePath.basename(dir);
  const bin = NodePath.join(dir, "bin");
  NodeFS.mkdirSync(bin, { recursive: true });
  const nodeTarget = NodePath.join(bin, "node");
  NodeFS.rmSync(nodeTarget, { force: true });
  try {
    NodeFS.linkSync(NODE_BIN, nodeTarget);
  } catch {
    NodeFS.copyFileSync(NODE_BIN, nodeTarget);
    NodeFS.chmodSync(nodeTarget, 0o755);
  }

  const client = NodePath.join(src, "apps/server/dist/client");
  const serverFingerprint = fingerprintServer(src);
  const clientFingerprint = fingerprint(client);

  const web = NodePath.join(dir, "web");
  NodeFS.rmSync(web, { recursive: true, force: true });
  NodeFS.cpSync(client, web, { recursive: true });
  // Stable serves the live "what dev has" summary next to the UI (see `fork pending`).
  NodeFS.symlinkSync(P.pending, NodePath.join(web, "fork-pending.json"));
  if (info.carryFrom)
    carryAssets(NodePath.join(info.carryFrom, "assets"), NodePath.join(web, "assets"));

  NodeFS.rmSync(client, { recursive: true, force: true });
  NodeFS.symlinkSync(P.clientCurrent, client);

  const serverPkg = readJson<{ version: string }>(NodePath.join(src, "apps/server/package.json"));
  const manifest: Manifest = {
    id,
    sha: info.sha,
    branch: info.branch,
    createdAt: new Date().toISOString(),
    nodeVersion: process.version,
    serverVersion: serverPkg?.version ?? "unknown",
    serverFingerprint,
    clientFingerprint,
    tests: info.tests,
  };
  writeJsonAtomic(NodePath.join(dir, "manifest.json"), manifest);
  return manifest;
}

function carryAssets(fromDir: string, toDir: string): void {
  if (!NodeFS.existsSync(fromDir)) return;
  let carried = 0;
  for (const name of NodeFS.readdirSync(fromDir)) {
    const target = NodePath.join(toDir, name);
    if (NodeFS.existsSync(target)) continue;
    NodeFS.cpSync(NodePath.join(fromDir, name), target, { recursive: true });
    carried++;
  }
  if (carried > 0)
    log(`  kept ${carried} asset file(s) from the previous UI so open tabs keep working`);
}

function walk(
  root: string,
  relative = "",
  skip: (rel: string) => boolean,
  out: string[] = [],
): string[] {
  const dir = NodePath.join(root, relative);
  for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (skip(rel)) continue;
    if (entry.isDirectory()) walk(root, rel, skip, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Hash of a build output tree: paths plus contents, ignoring source maps. */
export function fingerprint(root: string, skip: (rel: string) => boolean = () => false): string {
  const hash = NodeCrypto.createHash("sha256");
  for (const rel of walk(root, "", (rel) => rel.endsWith(".map") || skip(rel))) {
    hash.update(rel);
    hash.update("\0");
    hash.update(NodeFS.readFileSync(NodePath.join(root, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Everything the running server process depends on: its bundle (minus the bundled UI),
 * the lockfile (native/external dependencies load from node_modules), and the Node version.
 */
export function fingerprintServer(src: string): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(
    fingerprint(
      NodePath.join(src, "apps/server/dist"),
      (rel) => rel === "client" || rel.startsWith("client/"),
    ),
  );
  hash.update(NodeFS.readFileSync(NodePath.join(src, "pnpm-lock.yaml")));
  hash.update(process.version);
  return hash.digest("hex");
}

export interface Deployed {
  release: string;
  sha: string;
  at: string;
}

export interface HistoryEntry {
  at: string;
  kind: "server" | "client" | "rollback-server" | "rollback-client";
  result: "ok" | "rolled-back" | "failed";
  sha: string;
  fromServer?: string;
  toServer?: string;
  fromClient?: string;
  toClient?: string;
  snapshot?: string;
  dbMigrationBefore?: number;
  dbMigrationAfter?: number;
  note?: string;
}

export interface ForkState {
  server?: Deployed;
  client?: Deployed;
  history: HistoryEntry[];
}

export function readState(): ForkState {
  return readJson<ForkState>(P.state) ?? { history: [] };
}

export function writeState(state: ForkState): void {
  if (!DRY_RUN) writeJsonAtomic(P.state, state);
}

export function recordHistory(entry: HistoryEntry): void {
  const state = readState();
  state.history.push(entry);
  writeState(state);
}

/** Release ids the pointers currently use (never pruned). */
export function pointedReleases(): Set<string> {
  const ids = new Set<string>();
  for (const link of [P.current, P.clientCurrent]) {
    const target = readPointer(link);
    const match = target ? /releases\/([^/]+)/.exec(target) : null;
    if (match) ids.add(match[1]!);
  }
  return ids;
}

/** Left out of snapshots: logs, append-only files, and the live lock/runtime records. */
const SNAPSHOT_EXCLUDE = new Set([
  "logs",
  "attachments",
  "browser-artifacts",
  "server-owner.sqlite",
  "server-runtime.json",
]);

export interface SnapshotMeta {
  id: string;
  takenAt: string;
  release?: string;
  dbMigration?: number;
  reason: string;
}

/** Copy userdata while the server is stopped (a plain copy is consistent then). */
export function takeSnapshot(
  home: string,
  id: string,
  meta: Omit<SnapshotMeta, "id" | "takenAt">,
): string {
  const userdata = NodePath.join(home, "userdata");
  const dir = NodePath.join(P.snapshots, id);
  const target = NodePath.join(dir, "userdata");
  NodeFS.mkdirSync(target, { recursive: true });
  if (NodeFS.existsSync(userdata)) {
    for (const name of NodeFS.readdirSync(userdata)) {
      if (SNAPSHOT_EXCLUDE.has(name) || name.startsWith("server-owner.sqlite")) continue;
      NodeFS.cpSync(NodePath.join(userdata, name), NodePath.join(target, name), {
        recursive: true,
        preserveTimestamps: true,
      });
    }
  }
  writeJsonAtomic(NodePath.join(dir, "meta.json"), {
    id,
    takenAt: new Date().toISOString(),
    ...meta,
  } satisfies SnapshotMeta);
  return dir;
}

/** Make userdata match a snapshot again (except logs and append-only files). Server must be stopped. */
export function restoreSnapshot(home: string, snapshotDir: string): void {
  const userdata = NodePath.join(home, "userdata");
  const source = NodePath.join(snapshotDir, "userdata");
  if (!NodeFS.existsSync(source)) throw new ForkError(`Snapshot ${snapshotDir} has no userdata`);
  NodeFS.mkdirSync(userdata, { recursive: true });
  const keep = new Set(NodeFS.readdirSync(source));
  for (const name of NodeFS.readdirSync(userdata)) {
    if (SNAPSHOT_EXCLUDE.has(name) || name.startsWith("server-owner.sqlite")) continue;
    if (!keep.has(name) || name.startsWith("statev2.sqlite") || name.startsWith("state.sqlite")) {
      NodeFS.rmSync(NodePath.join(userdata, name), { recursive: true, force: true });
    }
  }
  for (const name of keep) {
    NodeFS.rmSync(NodePath.join(userdata, name), { recursive: true, force: true });
    NodeFS.cpSync(NodePath.join(source, name), NodePath.join(userdata, name), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
}

export function snapshotMeta(dir: string): SnapshotMeta | undefined {
  return readJson<SnapshotMeta>(NodePath.join(dir, "meta.json"));
}

export function prune(cfg: ForkConfig): void {
  const keepIds = pointedReleases();
  const state = readState();
  for (const deployed of [state.server, state.client]) if (deployed) keepIds.add(deployed.release);
  // Rollback targets: the newest distinct releases recorded in history.
  for (const entry of [...state.history].reverse()) {
    if (keepIds.size >= cfg.keep + 1) break;
    for (const id of [entry.toServer, entry.fromServer, entry.toClient, entry.fromClient])
      if (id) keepIds.add(id);
  }
  if (NodeFS.existsSync(P.releases)) {
    const releases = NodeFS.readdirSync(P.releases)
      .filter((name) => !name.startsWith("."))
      .sort()
      .reverse();
    let kept = 0;
    for (const id of releases) {
      if (keepIds.has(id) || kept < cfg.keep) {
        kept++;
        continue;
      }
      act(`prune release ${id}`, () =>
        NodeFS.rmSync(releaseDir(id), { recursive: true, force: true }),
      );
    }
    for (const name of NodeFS.readdirSync(P.releases).filter((name) =>
      name.startsWith(".building-"),
    )) {
      act(`remove abandoned build ${name}`, () =>
        NodeFS.rmSync(NodePath.join(P.releases, name), { recursive: true, force: true }),
      );
    }
  }
  if (NodeFS.existsSync(P.snapshots)) {
    const snapshots = NodeFS.readdirSync(P.snapshots).sort().reverse();
    const referenced = new Set(
      state.history
        .slice(-cfg.keep * 2)
        .map((entry) => entry.snapshot)
        .filter(Boolean),
    );
    snapshots.forEach((name, index) => {
      if (index < cfg.keep || referenced.has(NodePath.join(P.snapshots, name))) return;
      act(`prune snapshot ${name}`, () =>
        NodeFS.rmSync(NodePath.join(P.snapshots, name), { recursive: true, force: true }),
      );
    });
  }
}

export function warnIfDirty(repo: string): void {
  if (!isClean(repo)) warn(`${repo} has uncommitted changes`);
}
