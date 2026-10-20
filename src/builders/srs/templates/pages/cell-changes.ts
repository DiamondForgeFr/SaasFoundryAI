/**
 * The cells of a row that differ between two renderings of it, by the text of their column
 * header. A page is amended with exactly these: the other cells are never rewritten, so a cell
 * edited by hand in a column the amendment does not concern is left as it is (#945).
 */
export function changedCells(header: string[], before: string[], after: string[]): Record<string, string> {
  const cells: Record<string, string> = {}
  header.forEach((name, index) => {
    if (before[index] !== after[index]) cells[name] = after[index]
  })
  return cells
}
