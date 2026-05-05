export function workspaceStateSlug(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, "/").trim();
  const slug = normalized
    .replace(/^[A-Za-z]:/, (drive) => drive[0].toLowerCase())
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}
