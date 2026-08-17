export function getAddedIds(
  previous: readonly string[] | null,
  current: readonly string[]
): string[] {
  if (previous === null) return [];
  const previousSet = new Set(previous);
  return current.filter((id) => !previousSet.has(id));
}
