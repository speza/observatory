export interface HostError {
  readonly _tag: "HostError";
  readonly operation: string;
  readonly message: string;
}

export const hostError = (operation: string, message: string): HostError => ({
  _tag: "HostError",
  operation,
  message,
});
