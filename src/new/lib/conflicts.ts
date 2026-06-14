export class ConflictError extends Error {
  name = "ConflictError";

  constructor(message = "Program was updated by another session.") {
    super(message);
  }
}

