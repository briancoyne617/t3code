import type { ModelSelection } from "@t3tools/contracts";

import { type ComposerThreadTarget, useComposerDraftStore } from "./composerDraftStore";
import { withEffortOption } from "./composerEffortKeyword";

/**
 * A keyword turn updates the thread's stored selection on the server, and a dial left on its
 * default reads options from the thread. Pin the effort the dial showed into the draft so the
 * keyword lasts one turn; later turns then also send an explicit effort.
 */
export function pinComposerEffortDial(
  target: ComposerThreadTarget,
  dialSelection: ModelSelection,
  dialEffort: string | null,
): void {
  if (dialEffort === null) return;
  useComposerDraftStore
    .getState()
    .setModelSelection(target, withEffortOption(dialSelection, dialEffort), {
      replaceOptions: true,
    });
}
