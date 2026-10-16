import { test } from "node:test";
import assert from "node:assert/strict";
import { patchedRows, shownRows } from "../src/hydra/extension/rows.ts";
import { similarGamesText } from "../src/hydra/extension/strings.ts";

test("patchedRows reads only the feature patches' markers", () => {
  assert.deepEqual(patchedRows({}), []);
  assert.deepEqual(patchedRows({ similarGamesSteam: true }), ["steam", "original"]);
  assert.deepEqual(patchedRows({ similarGamesRevamped: true }), ["revamped", "original"]);
  assert.deepEqual(patchedRows({ similarGamesSteam: true, similarGamesRevamped: true }), ["steam", "revamped", "original"]);
  assert.deepEqual(patchedRows({ similarGamesSteam: "yes" }), []);
});

test("shownRows hides a row only for an explicit false", () => {
  const all = ["steam", "revamped", "original"] as const;
  assert.deepEqual(shownRows([...all], null), [...all]);
  assert.deepEqual(shownRows([...all], { showSimilarGamesRevamped: false }), ["steam", "original"]);
  assert.deepEqual(shownRows([...all], { showSimilarGamesSteam: 0, showSimilarGamesOriginal: null }), [...all]);
});

test("the strings are the fork's, with English for other languages", () => {
  assert.deepEqual(similarGamesText("en").title, { steam: "More like this (Steam)", revamped: "More like this (Revamped)", original: "More like this (Original)" });
  assert.equal(similarGamesText("en").show.original, "Show “More like this (Original)” on game pages");
  assert.equal(similarGamesText("bg").title.revamped, "Подобни игри (Обновени)");
  assert.equal(similarGamesText("bg").show.steam, "Показвай „Подобни игри (Steam)“ на страниците на игрите");
  assert.equal(similarGamesText("pt-BR").title.revamped, "Ver similares (Renovado)");
  assert.equal(similarGamesText("pt-BR").show.original, "Mostrar “Ver similares (Original)” nas páginas dos jogos");
  assert.deepEqual(similarGamesText("de"), similarGamesText("en"));
  assert.deepEqual(similarGamesText("pt-PT"), similarGamesText("en"));
});
