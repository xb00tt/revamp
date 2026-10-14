import { definePatch, fingerprint } from "@revamp/sdk";
import { heroic } from "../apps.ts";

/** Minified: `d.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),…})` in build/assets/App.js. */
export const dealsLink = fingerprint({
  name: "sidebar Deals link",
  strings: ['"discounts.sidebar"'],
  pattern: '$R.jsx($LINK, { url: "/discounts" })',
});

export const hideDealsLink = definePatch({
  name: "Hide Deals link",
  description: "Removes the Deals link from Heroic's sidebar.",
  compatibleWith: [{ app: heroic, versions: ["2.22.3"] }],
  execute(ctx) {
    ctx.match(dealsLink).replace("null"); // React renders nothing for null children
  },
});
