import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { COMPOSER_EFFORT_KEYWORDS, matchLeadingEffortKeyword } from "~/composerEffortKeyword";

const PILL_CLASS = "rounded-md bg-primary/15 px-1 font-medium text-primary";

export const ComposerEffortKeywordExtension = Extension.create({
  name: "composer-effort-keyword",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("composer-effort-keyword"),
        props: {
          decorations: ({ doc }) => {
            const first = doc.firstChild;
            // Cheap check first: the full-document text is only built when a keyword leads.
            if (
              first?.type.name !== "paragraph" ||
              !COMPOSER_EFFORT_KEYWORDS.some((keyword) => first.textContent.startsWith(keyword))
            ) {
              return null;
            }
            const match = matchLeadingEffortKeyword(
              doc.textBetween(0, doc.content.size, "\n", "￼"),
            );
            if (!match) return null;
            // Position 1 is the start of the first paragraph's content.
            return DecorationSet.create(doc, [
              Decoration.inline(1, 1 + match.keyword.length, { class: PILL_CLASS }),
            ]);
          },
        },
      }),
    ];
  },
});
