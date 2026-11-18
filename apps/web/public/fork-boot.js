// Fork: runs before the app loads (see index.html). Turns on the terminal style early so the
// boot screen already uses it, and paints the boot screen in the theme the app last showed.
// The app saves those colours (fork/terminalStyle.ts → saveBootColors) for each light/dark
// mode, so the boot screen follows both the T3 theme and, in "System" mode, the OS.
(function () {
  try {
    var root = document.documentElement;
    if (localStorage.getItem("fork.terminalStyle") !== "off") {
      root.setAttribute("data-fork-terminal", "");
    }
    var saved = JSON.parse(localStorage.getItem("fork.bootColors") || "null");
    if (!saved || typeof saved !== "object") return;
    var theme = localStorage.getItem("t3code:theme") || "";
    if (saved.theme !== theme) return; // Theme changed since; T3's own splash colours apply.
    var appearance = localStorage.getItem("t3code:theme-appearance-mode") || "system";
    var dark =
      appearance === "dark" ||
      (appearance !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var colors = saved[dark ? "dark" : "light"];
    if (!colors) return;
    root.classList.toggle("dark", dark);
    root.style.backgroundColor = colors.background;
    root.style.setProperty("--boot-background", colors.background);
    root.style.setProperty("--boot-foreground", colors.foreground);
    root.style.setProperty("--boot-accent", colors.accent);
    root.style.setProperty("--boot-muted", colors.muted);
    root.dataset.themeSelected = "true";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors.background);
  } catch (_) {
    // Storage blocked: T3's default boot screen is fine.
  }
})();
