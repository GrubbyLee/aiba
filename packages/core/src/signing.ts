import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { AibaError } from "./errors.js";

const requireFromHere = createRequire(import.meta.url);
const canonicalizeDocument: (input: unknown) => string | undefined = requireFromHere("canonicalize");

export function canonicalDocument(value: unknown): string {
  const document = canonicalizeDocument(value);
  if (document === undefined) {
    throw new AibaError("Document cannot be canonicalized", "CANONICALIZATION_FAILED");
  }
  return document;
}

function assertEd25519Key(key: KeyObject, purpose: "private" | "public"): void {
  if (key.type !== purpose || key.asymmetricKeyType !== "ed25519") {
    throw new AibaError(
      `Expected an Ed25519 ${purpose} key`,
      "UNSUPPORTED_SIGNING_KEY",
    );
  }
}

export async function loadEd25519PrivateKey(path: string): Promise<KeyObject> {
  const resolvedPath = resolve(path);
  const info = await lstat(resolvedPath).catch((error: unknown) => {
    throw new AibaError(`Cannot read private key ${path}`, "PRIVATE_KEY_NOT_FOUND", {
      cause: error,
    });
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AibaError("Private key must be a regular file", "INVALID_PRIVATE_KEY_PATH");
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(await readFile(resolvedPath));
  } catch (error) {
    throw new AibaError("Private key is invalid", "INVALID_PRIVATE_KEY", { cause: error });
  }
  assertEd25519Key(key, "private");
  return key;
}

export function loadEd25519PublicKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    throw new AibaError("Trusted public key is invalid", "INVALID_TRUSTED_PUBLIC_KEY", {
      cause: error,
    });
  }
  assertEd25519Key(key, "public");
  return key;
}
