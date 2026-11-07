"use client";

import { Button } from "@vbt/ui/components/button";

export function PrintButton(): React.JSX.Element {
  return (
    <Button type="button" className="w-full sm:w-auto" onClick={() => window.print()}>
      Print this sheet
    </Button>
  );
}
