/**
 * Server-safe panel primitives. Deliberately free of client hooks so these can
 * be rendered directly from Server Components. Interactive children (copy
 * buttons, zoom controls) are separate client components.
 */

/** Label/value row used across the Threat Report and Network panels. */
export function KvRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="dz-row flex items-baseline justify-between gap-4 py-[9px]">
      <dt className="shrink-0 text-[12.5px] text-label">{label}</dt>
      <dd
        className={`min-w-0 text-right text-[12.5px] break-words text-ink ${mono ? "mono-body" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}

/** Section container with an optional icon, matching the reference panels. */
export function Panel({
  title,
  icon,
  children,
  action,
  className = "",
  bodyClassName = "px-4 pb-4",
  headClassName = "px-4 pt-4 pb-3",
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headClassName?: string;
}) {
  return (
    <section className={`dz-card flex flex-col ${className}`}>
      <div className={`flex items-center justify-between gap-3 ${headClassName}`}>
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-ink">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
