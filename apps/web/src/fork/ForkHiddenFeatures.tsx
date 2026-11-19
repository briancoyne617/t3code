import { Button } from "../components/ui/button";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Switch } from "../components/ui/switch";
import { useForkHostResourcesVisibility } from "./ForkHostResources";
import { setTerminalStyle, useTerminalStyle } from "./terminalStyle";
import { RESTORE_ATTR, showAll, showRule, useHiddenRules } from "./hiddenUi";

/** Settings → Appearance: everything hidden with Alt+right-click, each with a way back. */
export function ForkHiddenFeatures() {
  return (
    <RenderErrorBoundary fallback={null}>
      <TerminalStyleSection />
      <HostResourcesSection />
      <HiddenFeaturesSection />
    </RenderErrorBoundary>
  );
}

function HiddenFeaturesSection() {
  const rules = useHiddenRules();
  return (
    <div {...{ [RESTORE_ATTR]: "" }}>
      <SettingsSection
        id="fork-hidden-features"
        title="Hidden features"
        headerAction={
          rules.length > 0 ? (
            <Button variant="ghost" size="compact" onClick={showAll}>
              Show all
            </Button>
          ) : null
        }
      >
        {rules.length === 0 ? (
          <SettingsRow
            title="Nothing hidden"
            description="Alt + right-click any part of T3 Code to hide it. Use ↑/↓ to pick a bigger or smaller piece, then Enter."
          />
        ) : (
          rules.map((rule) => (
            <SettingsRow
              key={rule.id}
              title={rule.label}
              description={
                <span className="font-mono text-2xs">
                  {rule.selector}
                  {rule.text ? ` text="${rule.text}"` : ""} · hidden on {rule.page}
                </span>
              }
              control={
                <Button variant="outline" size="compact" onClick={() => showRule(rule.id)}>
                  Show
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>
    </div>
  );
}

/** Settings → Appearance: the fork's terminal (Claude Code CLI) look. */
function TerminalStyleSection() {
  const enabled = useTerminalStyle();
  return (
    <SettingsSection id="fork-terminal-style" title="Terminal style">
      <SettingsRow
        title="Look like the Claude Code CLI"
        description="Monospace text, square corners, prompt-style messages and flat panels everywhere. Saved on this device."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setTerminalStyle(Boolean(checked))}
            aria-label="Terminal style"
          />
        }
      />
    </SettingsSection>
  );
}

function HostResourcesSection() {
  const [visible, setVisible] = useForkHostResourcesVisibility();
  return (
    <SettingsSection id="fork-host-resources" title="Chat header">
      <SettingsRow
        title="Show CPU and RAM"
        description="Display host usage in the chat header. Saved on this device."
        control={
          <Switch checked={visible} onCheckedChange={setVisible} aria-label="Show CPU and RAM" />
        }
      />
    </SettingsSection>
  );
}
