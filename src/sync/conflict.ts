export function direction(
  localHash: string,
  lastHash: string,
  revision: number | string,
  lastRevision: number | string,
) {
  const local = localHash !== lastHash,
    remote = revision !== lastRevision;
  return local ? (remote ? "conflict" : "push") : remote ? "pull" : "none";
}
