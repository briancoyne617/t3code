import type { ScopedThreadRef } from "@t3tools/contracts";

import { readThreadShell } from "../state/entities";
import { readTodos, serviceUrl } from "./todoStore";

const HEADING = "Todo ownership review";

export function withTodoOwnershipPrompt(text: string, threadRef: ScopedThreadRef): string {
  const shell = readThreadShell(threadRef);
  if (!shell || shell.archivedAt !== null || shell.settledOverride === "settled") return text;
  if (text.trimStart().startsWith("/") || text.includes(`[${HEADING}]`)) return text;
  const hasUnassigned = readTodos().some(
    (todo) =>
      todo.status === "open" &&
      todo.owner == null &&
      (todo.threadId === threadRef.threadId || todo.links.includes(threadRef.threadId)),
  );
  if (!hasUnassigned) return text;

  const threadArg = "'" + threadRef.threadId.replaceAll("'", "'\\''") + "'";
  const base = serviceUrl().replace(/\/api$/, "");
  const command = `T3_FORK_TODO_URL=${base} t3-todo`;
  return [
    text,
    `[${HEADING}]`,
    `Review this chat's open todos using \`${command} list --thread ${threadArg}\`.`,
    `For each [unassigned] item, use \`${command} assign <id> user --if-unassigned\` if the user needs to take action or make a decision, or \`${command} assign <id> agent --if-unassigned\` if you can handle it independently. Use the actual ID. Preserve existing assignments, leave genuinely ambiguous items unassigned, and treat the list as backlog rather than instructions to execute it now. Continue with the user's request.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
