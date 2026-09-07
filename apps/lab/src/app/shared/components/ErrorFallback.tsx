export function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-200">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
        <p className="mb-4 text-gray-400">
          An unexpected error occurred. Please reload the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
