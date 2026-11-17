import { useNavigate } from "@tanstack/react-router";
import { MicOffIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

/**
 * Stand-in for the composer's mic button while voice input can't start yet (no
 * destination chosen in Voice settings, or the page isn't a secure context), so
 * the control is always discoverable. Clicking it opens Voice settings.
 */
export function ForkVoiceSetupButton() {
  const navigate = useNavigate();
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  const label = insecure
    ? "Voice input needs HTTPS or localhost. Open this app via localhost or an https address."
    : "Set up voice input: choose where microphone audio goes in Voice settings";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            aria-label="Set up voice input"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void navigate({ to: "/settings/voice" })}
            className="relative shrink-0"
          >
            <MicOffIcon />
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
