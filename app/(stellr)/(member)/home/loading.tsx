// Streamed skeleton for the Home dashboard — matches the card shapes so there's
// no layout shift while the RSC data resolves.
export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse">
      <div className="mb-6">
        <div className="mb-2 h-4 w-28 rounded bg-brand-hairline" />
        <div className="h-9 w-56 rounded bg-brand-hairline" />
      </div>
      <div className="mb-[18px] h-40 rounded-card-lg bg-brand-hairline" />
      <div className="mb-[18px] grid gap-[18px] md:grid-cols-2">
        <div className="h-48 rounded-card border border-brand-border bg-white" />
        <div className="h-48 rounded-card border border-brand-border bg-white" />
      </div>
      <div className="h-56 rounded-card border border-brand-border bg-white" />
    </div>
  )
}
