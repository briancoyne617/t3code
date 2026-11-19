import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { filterCommandPaletteGroups, type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "./projectFilesQueryState";

interface ProjectFilePickerProps {
  readonly developerActions: ReadonlyArray<CommandPaletteActionItem>;
  readonly setOpen: (open: boolean) => void;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function OpenProjectFilePicker(
  props: ProjectFilePickerProps & {
    target: ActiveProjectTarget;
    query: string;
    setQuery: (query: string) => void;
  },
) {
  const { target } = props;
  const { query } = props;
  const result = useProjectFilePickerQuery(
    target.environmentId,
    target.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const { resolvedTheme } = useTheme();
  const matches = getProjectFilePickerMatches(result.entries, result.matchedQuery);
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  const items: CommandPaletteActionItem[] = matches.map((match) => ({
    kind: "action",
    value: `file:${match.path}`,
    searchTerms: [match.name, match.path],
    title: (
      <HighlightedFuzzyText
        active={hasMatchedQuery}
        value={match.name}
        indices={match.nameMatchIndices}
      />
    ),
    description: (
      <HighlightedFuzzyText
        active={hasMatchedQuery}
        value={match.path}
        indices={match.pathMatchIndices}
      />
    ),
    icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
    run: async () => {
      useRightPanelStore.getState().openFile(target.threadRef, match.path);
    },
  }));

  return (
    <ProjectFilePickerContent
      {...props}
      items={items}
      emptyStateMessage={getEmptyStateMessage(query, result.error, result.isPending)}
    />
  );
}

function ProjectFilePickerContent(
  props: ProjectFilePickerProps & {
    query: string;
    setQuery: (query: string) => void;
    items: CommandPaletteActionItem[];
    emptyStateMessage: string;
    target?: ActiveProjectTarget;
  },
) {
  const { query, setQuery, items } = props;
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const developerGroups = filterCommandPaletteGroups({
    activeGroups: [
      { value: "developer-tools", label: "Developer tools", items: props.developerActions },
    ],
    query,
    isInSubmenu: true,
    projectSearchItems: [],
    threadSearchItems: [],
  });
  return (
    <CommandPaletteContent
      aria-label="File picker"
      autoHighlight="always"
      escapeLabel="Back"
      footerActionLabel="Select"
      inputProps={{ placeholder: "Search files or developer tools…" }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="project-file-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={[
          ...(items.length > 0
            ? [{ value: "project-files", label: props.target?.projectName ?? "Files", items }]
            : []),
          ...developerGroups,
        ]}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={props.emptyStateMessage}
      />
    </CommandPaletteContent>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();
  const [query, setQuery] = useState("");

  if (!target) {
    return (
      <ProjectFilePickerContent
        {...props}
        query={query}
        setQuery={setQuery}
        items={[]}
        emptyStateMessage="Open a project to search its files."
      />
    );
  }

  return <OpenProjectFilePicker {...props} target={target} query={query} setQuery={setQuery} />;
}
