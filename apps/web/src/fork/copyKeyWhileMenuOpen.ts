/** The terminal's selection menu takes focus, so Ctrl/Cmd+C would land on the menu; copy instead. */
export function copyKeyWhileMenuOpen(onCopy: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "c" || event.altKey || !(event.ctrlKey || event.metaKey))
      return;
    event.preventDefault();
    event.stopPropagation();
    onCopy();
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
