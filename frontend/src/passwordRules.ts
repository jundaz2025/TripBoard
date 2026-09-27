// Client-side registration guidance mirrors server rules; the API remains the authority for validation.
export const passwordRules = [
  {
    label: "12–128 characters",
    test: (s: string) => s.length >= 12 && s.length <= 128,
  },
  { label: "Uppercase letter", test: (s: string) => /[A-Z]/.test(s) },
  { label: "Lowercase letter", test: (s: string) => /[a-z]/.test(s) },
  { label: "Number", test: (s: string) => /[0-9]/.test(s) },
  {
    label: "Symbol (e.g. ! @ #)",
    test: (s: string) => /[^A-Za-z0-9\s]/.test(s),
  },
];
