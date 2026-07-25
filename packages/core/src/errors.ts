export class AibaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AibaError";
  }
}

export class ProtocolValidationError extends AibaError {
  constructor(
    public readonly documentType: string,
    public readonly validationErrors: string[],
  ) {
    super(
      `Invalid ${documentType}: ${validationErrors.join("; ")}`,
      "PROTOCOL_VALIDATION_FAILED",
    );
    this.name = "ProtocolValidationError";
  }
}
