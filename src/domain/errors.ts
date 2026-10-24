export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertDomain(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
