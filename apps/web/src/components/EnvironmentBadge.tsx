/**
 * Small attention-colour pill for ENVIRONMENT_LABEL (see apps/api/src/env.ts)
 * — lets multiple deployments (e.g. rwnd.tv vs dev.rwnd.tv) be told apart at
 * a glance. Renders nothing when unset, which is the default for a normal
 * single-instance deployment.
 */
export function EnvironmentBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null

  return (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-500">
      {label}
    </span>
  )
}
