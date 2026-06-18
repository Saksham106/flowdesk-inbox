"use client";

export default function InboxError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700">Something went wrong</p>
        <p className="mt-1 text-xs text-slate-400">
          {error.digest ? `Error ${error.digest}` : "An unexpected error occurred."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
