"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDbStarting =
    error.message?.includes("database system is starting up") ||
    error.message?.includes("PrismaClientInitializationError") ||
    error.message?.includes("Can't reach database server");

  useEffect(() => {
    if (isDbStarting) {
      const t = setTimeout(() => reset(), 4000);
      return () => clearTimeout(t);
    }
  }, [isDbStarting, reset]);

  return (
    <html>
      <body className="bg-slate-50">
        <div className="flex min-h-screen items-center justify-center">
          {isDbStarting ? (
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <p className="text-sm font-medium text-slate-700">Warming up…</p>
              <p className="mt-1 text-xs text-slate-400">
                The database is starting up. Refreshing in a moment.
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Something went wrong</p>
              <p className="mt-1 text-xs text-slate-400">
                {error.digest ? `Error ${error.digest}` : "An unexpected error occurred."}
              </p>
              <button
                onClick={reset}
                className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
