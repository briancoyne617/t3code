// Ctrl+P groups beyond the project: folder navigation for typed paths, and a home-folder search.
import { FolderOpenIcon } from "lucide-react";
import type { ReactNode } from "react";

import type {
  CommandPaletteActionItem,
  CommandPaletteGroup,
} from "~/components/CommandPalette.logic";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import { getProjectFilePickerMatches } from "~/components/files/ProjectFilePicker.logic";
import type { ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useRightPanelStore } from "~/rightPanelStore";
import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { projectEnvironment } from "~/state/projects";
import { useProjectPathSearch } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";

import {
  filePanelPath,
  HOME_SEARCH_LIMIT,
  homeEntriesOutsideProject,
  matchPathListing,
  parsePathQuery,
  projectCoversHome,
  resolvePathQueryDirectory,
} from "./filePickerPaths";

const PATH_ITEM_PREFIX = "path:";

function FuzzyText(props: { readonly value: string; readonly indices: ReadonlyArray<number> }) {
  if (props.indices.length === 0) return props.value;
  const marked = new Set(props.indices);
  const parts: ReactNode[] = [];
  let run = "";
  for (let index = 0; index < props.value.length; index += 1) {
    const character = props.value[index];
    if (!marked.has(index)) {
      run += character;
      continue;
    }
    if (run) parts.push(run);
    run = "";
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {character}
      </strong>,
    );
  }
  if (run) parts.push(run);
  return <span className="text-muted-foreground">{parts}</span>;
}

export interface ForkFilePickerGroups {
  /** The query is a path: show only `groups`, not project matches. */
  readonly pathMode: boolean;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly isPending: boolean;
  /** Set in path mode, where the project's empty-state wording does not fit. */
  readonly emptyStateMessage: string | null;
  /** Tab: enter the highlighted folder, or complete the highlighted file's path. */
  readonly complete: (highlightedValue: string | null) => boolean;
}

export function useForkFilePickerGroups(input: {
  readonly target: ActiveProjectTarget;
  readonly query: string;
  readonly setQuery: (query: string) => void;
}): ForkFilePickerGroups {
  const { target, query, setQuery } = input;
  const { environmentId, cwd, threadRef } = target;
  const { resolvedTheme } = useTheme();
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const pathQuery = parsePathQuery(query);
  const searchQuery = query.trim();

  // The server's home folder tells project files apart and opens `~/` paths as project files.
  const wantsHome =
    pathQuery === null ? searchQuery.length > 0 : pathQuery.directory.startsWith("~/");
  const homeQuery = useEnvironmentQuery(
    canReadFiles && wantsHome
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: "~/" } })
      : null,
  );
  const home = homeQuery.data?.parentPath ?? null;

  const searchHome =
    pathQuery === null && searchQuery.length > 0 && home !== null && !projectCoversHome(home, cwd);
  const homeSearch = useProjectPathSearch(
    {
      environmentId,
      cwd: searchHome ? home : null,
      query: searchHome ? searchQuery : null,
      kind: "file",
    },
    HOME_SEARCH_LIMIT,
  );

  const listingRoot = pathQuery ? resolvePathQueryDirectory(pathQuery.directory, cwd) : null;
  const listing = useEnvironmentQuery(
    canReadFiles && listingRoot !== null
      ? projectEnvironment.listEntries({
          environmentId,
          input: { cwd: listingRoot, directoryPath: "" },
        })
      : null,
  );

  const open = (hostPath: string, line?: number) => {
    useRightPanelStore.getState().openFile(threadRef, filePanelPath(hostPath, cwd, home), line);
  };

  if (pathQuery === null || listingRoot === null) {
    const items: CommandPaletteActionItem[] = [];
    if (searchHome && home !== null && !homeSearch.isPending) {
      const entries = homeEntriesOutsideProject(homeSearch.entries, home, cwd);
      for (const match of getProjectFilePickerMatches(
        entries,
        homeSearch.searchedQuery,
        HOME_SEARCH_LIMIT,
      )) {
        const displayPath = `~/${match.path}`;
        items.push({
          kind: "action",
          value: `home:${match.path}`,
          searchTerms: [match.name, displayPath],
          title: <FuzzyText value={match.name} indices={match.nameMatchIndices} />,
          description: (
            <FuzzyText
              value={displayPath}
              indices={match.pathMatchIndices.map((index) => index + 2)}
            />
          ),
          icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
          run: async () => open(displayPath),
        });
      }
    }
    return {
      pathMode: false,
      groups: items.length > 0 ? [{ value: "home-files", label: "Home folder (~)", items }] : [],
      isPending: searchHome && homeSearch.isPending,
      emptyStateMessage: null,
      complete: () => false,
    };
  }

  const items: CommandPaletteActionItem[] = [];
  // A bare `~` is not a host path to the panel, so the home folder waits for its absolute path.
  const folderPath = filePanelPath(listingRoot.replace(/(.)\/+$/, "$1"), cwd, home);
  if (pathQuery.leaf.length === 0 && listing.error === null && folderPath !== "~") {
    items.push({
      kind: "action",
      value: `${PATH_ITEM_PREFIX}open-folder:${pathQuery.directory}`,
      searchTerms: [pathQuery.directory],
      title: "Open this folder in the Files panel",
      description: pathQuery.directory,
      icon: <FolderOpenIcon className="size-4 text-icon-muted" />,
      run: async () => {
        useRightPanelStore.getState().openFile(threadRef, folderPath);
      },
    });
  }
  for (const match of matchPathListing(listing.data?.entries ?? [], pathQuery.leaf)) {
    const typedPath = `${pathQuery.directory}${match.name}`;
    const hostPath = `${listingRoot}${match.name}`;
    if (match.kind === "directory") {
      items.push({
        kind: "action",
        value: `${PATH_ITEM_PREFIX}${typedPath}/`,
        searchTerms: [typedPath],
        title: `${match.name}/`,
        description: `${typedPath}/`,
        icon: <PierreEntryIcon pathValue={typedPath} kind="directory" theme={resolvedTheme} />,
        keepOpen: true,
        run: async () => setQuery(`${typedPath}/`),
      });
    } else {
      items.push({
        kind: "action",
        value: `${PATH_ITEM_PREFIX}${typedPath}`,
        searchTerms: [typedPath],
        title: match.name,
        description: pathQuery.line === undefined ? typedPath : `${typedPath}:${pathQuery.line}`,
        icon: <PierreEntryIcon pathValue={typedPath} kind="file" theme={resolvedTheme} />,
        run: async () => open(hostPath, pathQuery.line),
      });
    }
  }

  const emptyStateMessage = !canReadFiles
    ? "This connection cannot read host files."
    : listing.error !== null
      ? `Can't open ${pathQuery.directory}: ${listing.error}`
      : listing.isPending
        ? "Reading folder…"
        : `Nothing in ${pathQuery.directory} matches "${pathQuery.leaf}".`;

  return {
    pathMode: true,
    groups: items.length > 0 ? [{ value: "path-files", label: pathQuery.directory, items }] : [],
    isPending: listing.isPending,
    emptyStateMessage,
    complete: (highlightedValue) => {
      const value =
        highlightedValue?.startsWith(PATH_ITEM_PREFIX) === true
          ? highlightedValue
          : (items.find((item) => !item.value.includes("open-folder:"))?.value ?? null);
      if (value === null || value.startsWith(`${PATH_ITEM_PREFIX}open-folder:`)) return false;
      setQuery(value.slice(PATH_ITEM_PREFIX.length));
      return true;
    },
  };
}
