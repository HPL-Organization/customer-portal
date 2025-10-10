"use client";

import * as React from "react";

type ParsedAddress = {
  address1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export default function AddressAutocomplete({
  onAddressSelect,
  placeholder = "Start typing address...",
  autoApply = false,
  className,
  inputClassName,
  country,
}: {
  onAddressSelect: (parsed: ParsedAddress) => void;
  placeholder?: string;
  autoApply?: boolean;
  className?: string;
  inputClassName?: string;
  country?: string | string[];
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = React.useState<ParsedAddress | null>(null);

  React.useEffect(() => {
    // bail if google script not loaded yet
    const g = (globalThis as any).google;
    if (!g?.maps?.places || !inputRef.current) return;

    const options: any = {
      types: ["address"],
    };
    if (country) options.componentRestrictions = { country };

    const autocomplete = new g.maps.places.Autocomplete(
      inputRef.current,
      options
    );

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place?.address_components) return;

      const result: ParsedAddress = {
        address1: "",
        city: "",
        state: "",
        zip: "",
        country: "",
      };

      for (const comp of place.address_components as Array<any>) {
        const types: string[] = comp.types || [];
        if (types.includes("street_number")) result.address1 = comp.long_name;
        if (types.includes("route"))
          result.address1 = `${result.address1 ? result.address1 + " " : ""}${
            comp.long_name
          }`;
        if (types.includes("locality")) result.city = comp.long_name;
        if (types.includes("administrative_area_level_1"))
          result.state = comp.short_name;
        if (types.includes("postal_code")) result.zip = comp.long_name;
        if (types.includes("country")) result.country = comp.long_name;
      }

      if (autoApply) {
        onAddressSelect(result);
        if (inputRef.current) inputRef.current.value = "";
      } else {
        setParsed(result);
      }
    });

    return () => {
      if (listener) listener.remove?.();
      if (g?.maps?.event && autocomplete) {
        g.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, [autoApply, country, onAddressSelect]);

  const handleApply = () => {
    if (!parsed) return;
    onAddressSelect(parsed);
    setParsed(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <input
        ref={inputRef}
        placeholder={placeholder}
        className={[
          "w-full rounded border border-gray-300 px-2 py-1 text-black",
          "focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500",
          inputClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {parsed && !autoApply && (
        <button
          onClick={handleApply}
          className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
        >
          Apply
        </button>
      )}
    </div>
  );
}
