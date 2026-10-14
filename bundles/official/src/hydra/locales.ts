import { definePatch, fingerprint, type Match } from "@revamp/sdk";

/** The fork's strings for Hydra's `library` namespace, by Hydra's language code. Other languages fall back to en. */
export const LIBRARY_STRINGS: Record<string, Record<string, string>> = {
  en: { sort_recently_downloaded: "Recently downloaded", sort_recently_added: "Recently added" },
  bg: { sort_recently_downloaded: "Наскоро изтеглени", sort_recently_added: "Наскоро добавени" },
  "pt-BR": { sort_recently_downloaded: "Baixados recentemente", sort_recently_added: "Adicionados recentemente" },
};

/**
 * The renderer's i18next `resources`: language code → locale object. Found by its keys, never by translated text
 * ("Most played" is in 23 locales). The main process has its own copy, and the renderer's flag map has the same
 * keys with string values, hence the checks.
 */
export const localeResources = fingerprint({
  name: "i18n resources",
  strings: ['"pt-BR"'],
  pattern: 'const $RESOURCES = { "pt-BR": $PT_BR, en: $EN, bg: $BG }',
  where: {
    "in the renderer": (m) => m.file.startsWith("out/renderer/"),
    "values are locale objects": (m) => [m.$PT_BR, m.$EN, m.$BG].every((c) => c.node?.type === "Identifier"),
  },
});

/** Internal "Hydra locales": adds LIBRARY_STRINGS to each locale's `library` namespace, skipping keys it already has. */
export const hydraLocales = definePatch({
  description: "Hydra locales",
  execute(ctx) {
    const resources = ctx.match(localeResources);
    const locales: Record<string, Match> = { en: resources.$EN.resolve(), bg: resources.$BG.resolve(), "pt-BR": resources.$PT_BR.resolve() };
    for (const [lang, strings] of Object.entries(LIBRARY_STRINGS)) {
      const library = locales[lang].find("library: $NS").$NS.resolve();
      const entries = library.findAll("$KEY: $VALUE");
      if (entries.length === 0) throw new Error(`the ${lang} library namespace (${library.file}:${library.line}) is empty`);
      const have = new Set(entries.map((e) => String(e.$KEY.node!.value ?? e.$KEY.node!.name)));
      const add = Object.entries(strings).filter(([key]) => !have.has(key));
      if (add.length > 0) entries.at(-1)!.insertAfter(add.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", "));
    }
  },
});
