"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useRef } from "react";

export default function SearchInput({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (q) {
          params.set("q", q);
        } else {
          params.delete("q");
        }
        router.replace(`${pathname}?${params.toString()}`);
      }, 600);
    },
    [router, pathname, searchParams]
  );

  return (
    <input
      type="search"
      defaultValue={defaultValue}
      onChange={handleChange}
      placeholder="Search by name or phone…"
      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm placeholder-slate-400 focus:border-slate-400 focus:outline-none"
    />
  );
}
