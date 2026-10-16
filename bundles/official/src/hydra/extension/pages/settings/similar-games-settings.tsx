import { useEffect, useState } from "react";

import { CheckboxField, registryEntries, useAppSelector, useTranslation } from "../../app.ts";
import { patchedRows, ROW_PREFERENCES } from "../../rows.ts";
import { similarGamesText } from "../../strings.ts";

// One checkbox per patched row, listed in Hydra's Settings under the stock options.
export function SimilarGamesSettings() {
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const { i18n } = useTranslation("settings");
  const rows = patchedRows(registryEntries());
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setChecked(Object.fromEntries(rows.map((row) => [row, preferences?.[ROW_PREFERENCES[row]] !== false])));
  }, [preferences]); // eslint-disable-line react-hooks/exhaustive-deps -- rows come from the registry and never change while mounted

  if (rows.length === 0) return null;
  const text = similarGamesText(i18n.language);

  return (
    <>
      {rows.map((row) => (
        <CheckboxField
          key={row}
          label={text.show[row]}
          checked={checked[row] ?? preferences?.[ROW_PREFERENCES[row]] !== false}
          onChange={() => {
            const next = !(checked[row] ?? preferences?.[ROW_PREFERENCES[row]] !== false);
            setChecked((current) => ({ ...current, [row]: next }));
            window.electron.updateUserPreferences({ [ROW_PREFERENCES[row]]: next });
          }}
        />
      ))}
    </>
  );
}
