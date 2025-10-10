export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="mb-6 h-8 w-48 rounded bg-slate-200 animate-pulse" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="h-20 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
        <div className="h-20 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
      </div>
      <ul className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="animate-pulse">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-4 w-1/3 rounded bg-slate-200" />
              <div className="mt-4 h-28 rounded-xl border border-slate-200 bg-slate-50" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
