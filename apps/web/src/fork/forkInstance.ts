/** Which fork instance this tab is on, and where the other one lives. Ports from fork/README.md. */
export type ForkInstance = "dev" | "stable";

const STABLE_PORT = "3773";
const DEV_PORT = "5833";
// Dev uses a different hostname than stable on this machine so their login cookies stay apart.
const LOCAL_URLS: Record<ForkInstance, string> = {
  stable: `http://localhost:${STABLE_PORT}/`,
  dev: `http://127.0.0.1:${DEV_PORT}/`,
};

export function currentForkInstance(location: Pick<Location, "port"> = window.location) {
  if (location.port === DEV_PORT) return "dev";
  if (location.port === STABLE_PORT) return "stable";
  return import.meta.env.DEV ? "dev" : "stable";
}

/** Opened from this machine: the README's URLs. From the LAN: the same host, the other port. */
export function forkInstanceUrl(
  instance: ForkInstance,
  location: Pick<Location, "hostname" | "protocol"> = window.location,
): string {
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (local) return LOCAL_URLS[instance];
  const port = instance === "dev" ? DEV_PORT : STABLE_PORT;
  return `${location.protocol}//${location.hostname}:${port}/`;
}
