import { FlagIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "../lib/utils";
import { type ChatFlag, cycleChatFlag, nextChatFlag, useChatFlag } from "./chatFlags";

const FLAG_TONE: Record<ChatFlag, string> = {
  1: "fill-red-500 text-red-500",
  2: "fill-yellow-500 text-yellow-500",
  3: "fill-blue-500 text-blue-500",
};
const FLAG_NAME = (flag: ChatFlag | undefined) =>
  flag === undefined ? "no priority" : `priority ${flag}`;

/** Sidebar chat flag: one click steps none → red → yellow → blue → none. Hidden until hover when unset. */
export function ForkChatFlag(props: { threadId: string }) {
  const flag = useChatFlag(props.threadId);
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    cycleChatFlag(props.threadId);
  };
  return (
    <button
      type="button"
      aria-label={`Chat ${FLAG_NAME(flag)}; click for ${FLAG_NAME(nextChatFlag(flag))}`}
      onClick={onClick}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        flag === undefined &&
          "text-muted-foreground/60 opacity-0 hover:text-foreground group-hover/sidebar-row:opacity-100 focus-visible:opacity-100",
      )}
    >
      <FlagIcon aria-hidden className={cn("size-3", flag !== undefined && FLAG_TONE[flag])} />
    </button>
  );
}
