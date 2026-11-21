// Ctrl+P beyond the project: folder navigation for typed paths, and home-folder hits.
import { getFilesystemBrowsePath } from "@t3tools/client-runtime/state/filesystem";
import type { ProjectEntry } from "@t3tools/contracts";
import { splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { isHostPath, workspaceRelativeFilePath } from "@t3tools/shared/path";

import { resolveInlineCodeFileLinkMeta } from "~/markdown-links";

export const HOME_SEARCH_LIMIT = 50;
const PATH_LISTING_LIMIT = 200;

export interface PathQuery {
  /** The folder as typed, ending in `/`: `~/.config/`, `/etc/`, `./src/`. */
  readonly directory: string;
  /** The name typed inside that folder, without a `:line` suffix. */
  readonly leaf: string;
  readonly line: number | undefined;
}

/** A query starting with `/`, `~/`, `./` or `../` navigates folders instead of fuzzy searching. */
export function parsePathQuery(query: string): PathQuery | null {
  const browse = getFilesystemBrowsePath(query.trim());
  if (!browse.isBrowsing) return null;
  const { path, line } = splitFilePathPosition(browse.filterQuery);
  return { directory: browse.directoryPath, leaf: path, line };
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

/** Collapse `.`, `..` and repeated slashes in an absolute POSIX path, keeping a trailing slash. */
function normalizeAbsolutePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const joined = `/${segments.join("/")}`;
  return value.endsWith("/") && joined !== "/" ? `${joined}/` : joined;
}

/** The host folder to list; `./` and `../` resolve from the project. */
export function resolvePathQueryDirectory(directory: string, cwd: string): string {
  if (directory.startsWith("./") || directory.startsWith("../")) {
    return normalizeAbsolutePath(`${trimTrailingSlashes(cwd)}/${directory}`);
  }
  return directory;
}

export interface PathListingMatch {
  readonly name: string;
  readonly kind: ProjectEntry["kind"];
}

/** Exact name first, then prefix and substring matches; folders before files. Dotfiles need a typed `.`. */
export function matchPathListing(
  entries: ReadonlyArray<ProjectEntry>,
  leaf: string,
  limit = PATH_LISTING_LIMIT,
): PathListingMatch[] {
  const lowerLeaf = leaf.toLowerCase();
  const showHidden = leaf.startsWith(".");
  const ranked: Array<PathListingMatch & { readonly rank: number }> = [];
  for (const entry of entries) {
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (!showHidden && name.startsWith(".")) continue;
    const lowerName = name.toLowerCase();
    const rank =
      name === leaf
        ? 0
        : lowerName.startsWith(lowerLeaf)
          ? 1
          : lowerName.includes(lowerLeaf)
            ? 2
            : -1;
    if (rank >= 0) ranked.push({ name, kind: entry.kind, rank });
  }
  ranked.sort(
    (left, right) =>
      left.rank - right.rank ||
      (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1) ||
      left.name.localeCompare(right.name),
  );
  return ranked.slice(0, limit).map(({ name, kind }) => ({ name, kind }));
}

/** What the Files panel opens: project-relative inside the project (editable there), else the host path. */
export function filePanelPath(hostPath: string, cwd: string, home: string | null): string {
  const absolute =
    home !== null && (hostPath === "~" || hostPath.startsWith("~/"))
      ? `${trimTrailingSlashes(home)}${hostPath.slice(1)}`
      : hostPath;
  return workspaceRelativeFilePath(trimTrailingSlashes(absolute), cwd) ?? absolute;
}

/** Home search is redundant when the project already covers the home folder. */
export function projectCoversHome(home: string, cwd: string): boolean {
  return workspaceRelativeFilePath(home, cwd) !== null;
}

/** Home-relative hits outside the project; the project group already lists the others. */
export function homeEntriesOutsideProject(
  entries: ReadonlyArray<ProjectEntry>,
  home: string,
  cwd: string,
): ProjectEntry[] {
  const root = trimTrailingSlashes(home);
  return entries.filter(
    (entry) =>
      entry.kind === "file" && workspaceRelativeFilePath(`${root}/${entry.path}`, cwd) === null,
  );
}

export interface CodeBlockFileTarget {
  readonly panelPath: string;
  readonly line?: number;
}

/** A fenced block holding only a file path opens like an inline-code path link. */
export function codeBlockFileTarget(
  code: string,
  cwd: string | undefined,
  baseDir: string | undefined,
): CodeBlockFileTarget | null {
  const trimmed = code.trim();
  if (trimmed.length === 0 || trimmed.includes("\n")) return null;
  const meta = resolveInlineCodeFileLinkMeta(trimmed, cwd, baseDir);
  if (!meta) return null;
  const panelPath =
    meta.workspaceRelativePath ?? (isHostPath(meta.filePath) ? meta.filePath : null);
  if (panelPath === null) return null;
  return meta.line === undefined ? { panelPath } : { panelPath, line: meta.line };
}
