import type { ComponentProps } from "react";
import { SiteBanner } from "./SiteBanner.js";

/** Page account display; the page supplies its session and actions. */
export function PageBanner(props: ComponentProps<typeof SiteBanner>) {
  return <SiteBanner {...props} />;
}
