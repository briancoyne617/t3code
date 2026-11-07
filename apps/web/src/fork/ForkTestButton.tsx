import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";

export function ForkTestButton() {
  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={() => toastManager.add({ type: "info", title: "Hello from your fork" })}
    >
      Fork test
    </Button>
  );
}
