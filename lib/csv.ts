/**
 * Rows to CSV, safe to open in a spreadsheet.
 *
 * Two jobs. Quoting: a field with a comma, quote, newline or edge space is
 * wrapped in quotes with its quotes doubled, so it comes back as one cell.
 * And formula injection: a spreadsheet runs a cell that starts with `=` or `@`
 * (or `+`/`-` followed by anything but a number) as a formula, and the text of
 * a table in a chat is written by a model — possibly from a web page it read.
 * Such a cell gets a leading apostrophe, which spreadsheets show as plain
 * text. Real numbers like `-5` or `+3.2%` are left alone, so they stay numbers.
 */
const NUMBERISH = /^[+-]?[\d.,]+%?$/;

function neutralize(field: string): string {
  const first = field[0];
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${field}`;
  if ((first === "+" || first === "-") && !NUMBERISH.test(field.trim())) return `'${field}`;
  return field;
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const field = neutralize(cell);
          return /[",\n\r]/.test(field) || field !== field.trim() ? `"${field.replace(/"/g, '""')}"` : field;
        })
        .join(","),
    )
    .join("\r\n");
}
