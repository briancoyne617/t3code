import {
  ActivityIcon,
  ArrowLeftRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  HammerIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { currentForkInstance, type ForkInstance, forkInstanceUrl } from "./forkInstance";
import { useForkUpdatesDialog } from "./ForkUpdatesDialog";
import { useForkTerminalCommand } from "./useForkTerminalCommand";

const INSTANCE_STYLE: Record<ForkInstance, { name: string; badge: string; blurb: string }> = {
  dev: {
    name: "DEV",
    badge: "border-warning bg-warning/16 text-warning-foreground",
    blurb: "Agent-edited sandbox. Safe to break.",
  },
  stable: {
    name: "STABLE",
    badge: "border-success bg-success/16 text-success-foreground",
    blurb: "Your daily driver. Changes arrive by promote.",
  },
};

/** Top-left hammer: which instance this is, a switch to the other one, and the fork dev tools. */
export function ForkDevMenu() {
  const updates = useForkUpdatesDialog();
  const forkCommand = useForkTerminalCommand();
  const here = currentForkInstance();
  const style = INSTANCE_STYLE[here];

  const switchItem = (instance: ForkInstance) => {
    const active = instance === here;
    const label = instance === "dev" ? "Dev" : "Stable";
    return active ? (
      <MenuItem key={instance} disabled>
        <CheckIcon className="size-4" />
        <MenuItemLabel>{label}</MenuItemLabel>
        <MenuShortcut>you're here</MenuShortcut>
      </MenuItem>
    ) : (
      <MenuItem key={instance} render={<a href={forkInstanceUrl(instance)} />}>
        <ExternalLinkIcon className="size-4" />
        <MenuItemLabel>Open {label}</MenuItemLabel>
        <MenuShortcut>{new URL(forkInstanceUrl(instance)).host}</MenuShortcut>
      </MenuItem>
    );
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`T3 developer tools (on ${here})`}
              data-fork-instance={here}
            />
          }
        >
          <HammerIcon className={cn("size-4", here === "dev" && "text-warning")} />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-64">
          <div className="flex flex-col gap-1 px-2 pt-1.5 pb-2" data-fork-instance-header>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">You're on</span>
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 font-bold text-base tracking-wider",
                  style.badge,
                )}
              >
                {style.name}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {window.location.host}
              </span>
            </div>
            <span className="text-muted-foreground text-xs">{style.blurb}</span>
          </div>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Switch instance</MenuGroupLabel>
            {switchItem("stable")}
            {switchItem("dev")}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Fork</MenuGroupLabel>
            <MenuItem onClick={updates.openDialog}>
              <ArrowLeftRightIcon className="size-4" />
              <MenuItemLabel>Dev ↔ Stable changes…</MenuItemLabel>
            </MenuItem>
            <MenuItem
              onClick={() =>
                void forkCommand.run("./fork/bin/fork status --fetch").then((ran) => {
                  if (ran)
                    toastManager.add({ type: "info", title: "Fork status is in the terminal" });
                })
              }
            >
              <ActivityIcon className="size-4" />
              <MenuItemLabel>Fork status</MenuItemLabel>
              <MenuShortcut>terminal</MenuShortcut>
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
      {updates.dialog}
    </>
  );
}
