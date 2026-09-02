export const positiveIntegerSetting = (
  name: string,
  raw: string | undefined,
  fallback: number,
  options?: { readonly minimum?: number; readonly maximum?: number },
): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  const minimum = options?.minimum ?? 1;
  const maximum = options?.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
};
