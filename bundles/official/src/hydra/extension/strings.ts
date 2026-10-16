import type { SimilarGamesSource } from "./hooks/similar-games.ts";

// The fork's strings. The extension has no access to Hydra's i18n resources, so it carries its own table;
// languages the fork did not translate get English.
type Text = { title: Record<SimilarGamesSource, string>; show: Record<SimilarGamesSource, string> };

const en: Text = {
  title: { steam: "More like this (Steam)", revamped: "More like this (Revamped)", original: "More like this (Original)" },
  show: {
    steam: "Show “More like this (Steam)” on game pages",
    revamped: "Show “More like this (Revamped)” on game pages",
    original: "Show “More like this (Original)” on game pages",
  },
};

const TEXT: Record<string, Text> = {
  en,
  bg: {
    title: { steam: "Подобни игри (Steam)", revamped: "Подобни игри (Обновени)", original: "Подобни игри (Оригинални)" },
    show: {
      steam: "Показвай „Подобни игри (Steam)“ на страниците на игрите",
      revamped: "Показвай „Подобни игри (Обновени)“ на страниците на игрите",
      original: "Показвай „Подобни игри (Оригинални)“ на страниците на игрите",
    },
  },
  "pt-BR": {
    title: { steam: "Ver similares (Steam)", revamped: "Ver similares (Renovado)", original: "Ver similares (Original)" },
    show: {
      steam: "Mostrar “Ver similares (Steam)” nas páginas dos jogos",
      revamped: "Mostrar “Ver similares (Renovado)” nas páginas dos jogos",
      original: "Mostrar “Ver similares (Original)” nas páginas dos jogos",
    },
  },
};

export const similarGamesText = (language: string): Text => (Object.hasOwn(TEXT, language) ? TEXT[language] : en);
