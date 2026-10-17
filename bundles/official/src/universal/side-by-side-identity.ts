import { definePatch, fingerprint, option } from "@revamp-app/sdk";

export const protocolRegistration = fingerprint({
  name: "setAsDefaultProtocolClient call",
  strings: ["setAsDefaultProtocolClient("],
  count: "many",
  pattern: "$APP.setAsDefaultProtocolClient($$$)",
});

export const sideBySideIdentity = definePatch({
  name: "Side-by-side identity",
  description:
    "Gives the patched copy its own menu name and window class (Electron's desktopName), so it doesn't merge with the stock app in menus and panels.",
  options: {
    claimLinks: option.bool({
      title: "Open app links in the Revamped copy",
      description: "When off, the Revamped copy never registers itself for the app's links, so links keep opening the stock app.",
      default: true,
    }),
  },
  execute(ctx) {
    const id = `revamp-${ctx.app.id}`;
    const pkg = ctx.file("package.json");
    pkg.setJson({ ...pkg.json<Record<string, unknown>>(), desktopName: `${id}.desktop` });
    ctx.desktopEntry.Name = `${ctx.desktopEntry.Name ?? ctx.app.id} (Revamped)`;
    ctx.desktopEntry.StartupWMClass = id;
    if (ctx.options.claimLinks === false) {
      for (const call of ctx.matchAll(protocolRegistration)) call.replace("false");
      delete ctx.desktopEntry.MimeType;
    }
  },
});
