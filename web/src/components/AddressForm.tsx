import { useState } from "react";

export type Address = {
  name: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
};

const FIELDS: { key: keyof Address; label: string; autoComplete: string }[] = [
  { key: "name", label: "Full name", autoComplete: "name" },
  { key: "street", label: "Street and number", autoComplete: "street-address" },
  { key: "postal_code", label: "Postal code", autoComplete: "postal-code" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "country", label: "Country", autoComplete: "country-name" },
];

export function AddressForm({
  message,
  onSubmit,
  onCancel,
}: {
  message?: string;
  onSubmit: (a: Address) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<Address>({
    name: "",
    street: "",
    postal_code: "",
    city: "",
    country: "",
  });

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="form-title">📍 The agent needs an address</div>
      {message && <p className="muted">{message}</p>}
      {FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <input
            required
            autoComplete={f.autoComplete}
            value={value[f.key]}
            onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Don't share
        </button>
        <button type="submit">Send address</button>
      </div>
    </form>
  );
}
