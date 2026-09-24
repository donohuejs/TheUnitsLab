"use client";

import { useRouter } from "next/navigation";

export type BrowseFilterSelectOption = {
  value: string;
  label: string;
  href: string;
};

export function BrowseFilterSelect({
  id,
  label,
  value,
  options,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly BrowseFilterSelectOption[];
}) {
  const router = useRouter();

  return (
    <label className="browse-filter-select-control" htmlFor={id}>
      <span className="browse-filter-label">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.value === event.target.value);
          if (option) router.push(option.href, { scroll: false });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
