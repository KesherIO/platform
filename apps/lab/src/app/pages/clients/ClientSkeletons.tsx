export function ClientsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex w-full items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
        >
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-700" />
            <div className="space-y-2">
              <div className="h-4 w-36 animate-pulse rounded bg-gray-700" />
              <div className="h-3 w-48 animate-pulse rounded bg-gray-800" />
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="space-y-2 text-right">
              <div className="ml-auto h-3 w-28 animate-pulse rounded bg-gray-800" />
              <div className="ml-auto h-3 w-20 animate-pulse rounded bg-gray-800" />
            </div>
            <div className="h-6 w-16 animate-pulse rounded-full bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientDetailSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 h-4 w-20 animate-pulse rounded bg-gray-800" />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-gray-700" />
          <div className="space-y-2">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-700" />
            <div className="h-3 w-56 animate-pulse rounded bg-gray-800" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-gray-800" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Info card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-4 h-4 w-36 animate-pulse rounded bg-gray-700" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 animate-pulse rounded bg-gray-800" />
                <div className="h-4 w-44 animate-pulse rounded bg-gray-700" />
              </div>
            ))}
          </div>
        </div>

        {/* Invitation card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-4 h-4 w-28 animate-pulse rounded bg-gray-700" />
          <div className="space-y-3">
            <div className="h-6 w-20 animate-pulse rounded-full bg-gray-700" />
            <div className="space-y-2">
              <div className="h-3 w-16 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-48 animate-pulse rounded bg-gray-700" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-16 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-36 animate-pulse rounded bg-gray-700" />
            </div>
          </div>
        </div>

        {/* Users card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-4 h-4 w-32 animate-pulse rounded bg-gray-700" />
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
              >
                <div className="h-8 w-8 animate-pulse rounded-full bg-gray-700" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-28 animate-pulse rounded bg-gray-700" />
                  <div className="h-3 w-40 animate-pulse rounded bg-gray-800" />
                </div>
                <div className="h-5 w-14 animate-pulse rounded-full bg-gray-800" />
              </div>
            ))}
          </div>
        </div>

        {/* Orders card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-4 h-4 w-32 animate-pulse rounded bg-gray-700" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2"
              >
                <div className="space-y-1">
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-700" />
                  <div className="h-3 w-36 animate-pulse rounded bg-gray-800" />
                </div>
                <div className="h-5 w-20 animate-pulse rounded-full bg-gray-800" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
