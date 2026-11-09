import { Button } from "../components/ui/button";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { RESTORE_ATTR, showAll, showRule, useHiddenRules } from "./hiddenUi";

/** Settings → Appearance: everything hidden with Alt+right-click, each with a way back. */
export function ForkHiddenFeatures() {
  return (
    <RenderErrorBoundary fallback={null}>
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
