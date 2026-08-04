import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "node:https";
import { join, resolve, sep } from "node:path";
import {
  AibaError,
  verifyCapabilityBundle,
  verifyCapabilityBundleEnvelope,
  verifyRegistryIndexSnapshot,
} from "aiba-core";

const MAX_TOKEN_SIZE = 8 * 1024;
const MAX_TLS_FILE_SIZE = 1024 * 1024;

interface RegistryRoute {
  path: string;
  contentType: string;
}

export interface RegistryServerOptions {
  registryDirectory: string;
  registryTrustPolicyPath: string;
  publisherTrustPolicyPath: string;
  token: string;
  tlsCertificatePath?: string;
  tlsPrivateKeyPath?: string;
  now?: () => Date;
  requestLimitPerMinute?: number;
  audit?: (event: RegistryAuditEvent) => void;
}

export interface RegistryAuditEvent {
  event: "request" | "unauthorized" | "rate-limited" | "internal-error";
  method: string;
  routeClass: "distribution" | "health" | "metrics" | "unknown";
  status: number;
  occurredAt: string;
}

export interface RegistryServerSnapshot {
  registry: string;
  sequence: number;
  indexSha256: string;
  capabilities: number;
  routes: number;
}

export interface CreatedRegistryServer {
  server: HttpServer | HttpsServer;
  snapshot: RegistryServerSnapshot;
  secure: boolean;
  metrics: RegistryServerMetrics;
}

export interface RegistryServerMetrics {
  startedAt: string;
  requests: number;
  unauthorized: number;
  rateLimited: number;
  internalErrors: number;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new AibaError(`${label} does not exist`, "INVALID_REGISTRY_LAYOUT", { cause: error });
  });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AibaError(`${label} must be a regular directory`, "INVALID_REGISTRY_LAYOUT");
  }
}

async function latestSequence(registryRoot: string): Promise<number> {
  const indexes = join(registryRoot, "indexes");
  await assertDirectory(indexes, "Registry indexes root");
  const entries = await readdir(indexes, { withFileTypes: true });
  const sequences: number[] = [];
  for (const entry of entries) {
    const sequence = Number(entry.name);
    const info = await lstat(join(indexes, entry.name));
    if (
      !entry.isDirectory()
      || info.isSymbolicLink()
      || !Number.isSafeInteger(sequence)
      || sequence < 1
      || String(sequence) !== entry.name
    ) {
      throw new AibaError(`Invalid registry index snapshot: ${entry.name}`, "INVALID_REGISTRY_LAYOUT");
    }
    sequences.push(sequence);
  }
  const latest = sequences.sort((left, right) => left - right).at(-1);
  if (latest === undefined) {
    throw new AibaError("Registry has no index snapshots", "REGISTRY_INDEX_NOT_FOUND");
  }
  return latest;
}

function contentType(path: string): string {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".yaml")) return "application/yaml; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function assertBundleMatchesEntry(
  bundle: Awaited<ReturnType<typeof verifyCapabilityBundle>>,
  entry: Awaited<ReturnType<typeof verifyRegistryIndexSnapshot>>["index"]["entries"][number],
): void {
  if (
    bundle.capability !== entry.capability
    || bundle.version !== entry.version
    || bundle.publisher !== entry.publisher
    || bundle.keyId !== entry.keyId
    || bundle.manifestSha256 !== entry.bundleManifestSha256
  ) {
    throw new AibaError(
      `Registry entry does not match verified bundle ${bundle.capability}@${bundle.version}`,
      "REGISTRY_BUNDLE_MISMATCH",
    );
  }
}

async function buildVerifiedRoutes(
  options: RegistryServerOptions,
): Promise<{ snapshot: RegistryServerSnapshot; routes: Map<string, RegistryRoute>; latest: Buffer }> {
  const root = resolve(options.registryDirectory);
  await assertDirectory(root, "Registry root");
  const sequence = await latestSequence(root);
  const snapshotDirectory = join(root, "indexes", String(sequence));
  const verifiedIndex = await verifyRegistryIndexSnapshot({
    snapshotDirectory,
    sequence,
    registryTrustPolicyPath: resolve(options.registryTrustPolicyPath),
    ...(options.now ? { now: options.now } : {}),
  });
  const routes = new Map<string, RegistryRoute>();
  const addRoute = (url: string, path: string): void => {
    if (routes.has(url)) {
      throw new AibaError(`Duplicate registry route: ${url}`, "DUPLICATE_REGISTRY_ROUTE");
    }
    routes.set(url, { path, contentType: contentType(path) });
  };
  addRoute(
    `/v0/indexes/${sequence}/index.json`,
    join(snapshotDirectory, "index.json"),
  );
  addRoute(
    `/v0/indexes/${sequence}/index.sig.json`,
    join(snapshotDirectory, "index.sig.json"),
  );
  for (const entry of verifiedIndex.index.entries) {
    const bundleDirectory = join(root, ...entry.path.split("/"));
    const bundle = await verifyCapabilityBundle({
      bundleDirectory,
      trustPolicyPath: resolve(options.publisherTrustPolicyPath),
    });
    assertBundleMatchesEntry(bundle, entry);
    const envelope = await verifyCapabilityBundleEnvelope({
      bundleManifestPath: join(bundleDirectory, "bundle.json"),
      bundleSignaturePath: join(bundleDirectory, "bundle.sig.json"),
      trustPolicyPath: resolve(options.publisherTrustPolicyPath),
    });
    const prefix = `/v0/bundles/${entry.capability}/${entry.version}`;
    addRoute(`${prefix}/bundle.json`, join(bundleDirectory, "bundle.json"));
    addRoute(`${prefix}/bundle.sig.json`, join(bundleDirectory, "bundle.sig.json"));
    for (const file of envelope.bundle.files) {
      addRoute(`${prefix}/${file.path}`, join(bundleDirectory, ...file.path.split("/")));
    }
  }
  return {
    snapshot: {
      registry: verifiedIndex.index.metadata.id,
      sequence,
      indexSha256: verifiedIndex.indexSha256,
      capabilities: verifiedIndex.index.entries.length,
      routes: routes.size + 1,
    },
    routes,
    latest: Buffer.from(`${JSON.stringify({ sequence })}\n`),
  };
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function isAuthorized(header: string | undefined, expectedDigest: Buffer): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const candidate = header.slice("Bearer ".length);
  return timingSafeEqual(tokenDigest(candidate), expectedDigest);
}

async function readRegularRouteFile(root: string, route: RegistryRoute): Promise<Buffer> {
  const info = await lstat(route.path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AibaError("Registry route target must be a regular file", "INVALID_REGISTRY_LAYOUT");
  }
  const [rootRealPath, fileRealPath] = await Promise.all([realpath(root), realpath(route.path)]);
  if (fileRealPath !== rootRealPath && !fileRealPath.startsWith(`${rootRealPath}${sep}`)) {
    throw new AibaError("Registry route escapes the registry root", "INVALID_REGISTRY_LAYOUT");
  }
  const bytes = await readFile(route.path);
  if (bytes.length !== info.size) {
    throw new AibaError("Registry file changed while reading", "REGISTRY_FILE_CHANGED");
  }
  return bytes;
}

function requestListener(
  root: string,
  token: string,
  routes: Map<string, RegistryRoute>,
  latest: Buffer,
  snapshot: RegistryServerSnapshot,
  options: Pick<RegistryServerOptions, "requestLimitPerMinute" | "audit" | "now">,
  metrics: RegistryServerMetrics,
): RequestListener {
  const expectedDigest = tokenDigest(token);
  const limit = options.requestLimitPerMinute ?? 600;
  let windowStarted = Date.now();
  let windowRequests = 0;
  const routeClass = (path: string): RegistryAuditEvent["routeClass"] =>
    path === "/healthz" || path === "/readyz"
      ? "health"
      : path === "/metrics"
        ? "metrics"
        : path.startsWith("/v0/")
          ? "distribution"
          : "unknown";
  const audit = (
    event: RegistryAuditEvent["event"],
    method: string,
    path: string,
    status: number,
  ): void => {
    options.audit?.({
      event,
      method,
      routeClass: routeClass(path),
      status,
      occurredAt: (options.now ?? (() => new Date()))().toISOString(),
    });
  };
  return (request, response) => {
    void (async () => {
      const requestPath = request.url ?? "";
      const method = request.method ?? "UNKNOWN";
      metrics.requests += 1;
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      if (!isAuthorized(request.headers.authorization, expectedDigest)) {
        metrics.unauthorized += 1;
        response.setHeader("www-authenticate", "Bearer");
        response.writeHead(401);
        response.end();
        audit("unauthorized", method, requestPath, 401);
        return;
      }
      const current = Date.now();
      if (current - windowStarted >= 60000) {
        windowStarted = current;
        windowRequests = 0;
      }
      windowRequests += 1;
      if (windowRequests > limit) {
        metrics.rateLimited += 1;
        response.setHeader("retry-after", "60");
        response.writeHead(429);
        response.end();
        audit("rate-limited", method, requestPath, 429);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        response.writeHead(405);
        response.end();
        audit("request", method, requestPath, 405);
        return;
      }
      if (
        !requestPath.startsWith("/")
        || requestPath.includes("?")
        || requestPath.includes("#")
        || requestPath.includes("%")
        || requestPath.includes("\\")
        || requestPath.includes("\0")
      ) {
        response.writeHead(400);
        response.end();
        audit("request", method, requestPath, 400);
        return;
      }
      let bytes: Buffer;
      let type = "application/json; charset=utf-8";
      if (requestPath === "/healthz") {
        bytes = Buffer.from(`${JSON.stringify({ status: "ok" })}\n`);
      } else if (requestPath === "/readyz") {
        bytes = Buffer.from(`${JSON.stringify({
          status: "ready",
          registry: snapshot.registry,
          sequence: snapshot.sequence,
        })}\n`);
      } else if (requestPath === "/metrics") {
        type = "text/plain; version=0.0.4; charset=utf-8";
        bytes = Buffer.from([
          "# HELP aiba_registry_up Registry readiness.",
          "# TYPE aiba_registry_up gauge",
          "aiba_registry_up 1",
          "# TYPE aiba_registry_requests_total counter",
          `aiba_registry_requests_total ${metrics.requests}`,
          "# TYPE aiba_registry_unauthorized_total counter",
          `aiba_registry_unauthorized_total ${metrics.unauthorized}`,
          "# TYPE aiba_registry_rate_limited_total counter",
          `aiba_registry_rate_limited_total ${metrics.rateLimited}`,
          "# TYPE aiba_registry_internal_errors_total counter",
          `aiba_registry_internal_errors_total ${metrics.internalErrors}`,
          "",
        ].join("\n"));
      } else if (requestPath === "/v0/indexes/latest.json") {
        bytes = latest;
      } else {
        const route = routes.get(requestPath);
        if (!route) {
          response.writeHead(404);
          response.end();
          audit("request", method, requestPath, 404);
          return;
        }
        bytes = await readRegularRouteFile(root, route);
        type = route.contentType;
      }
      response.setHeader("content-type", type);
      response.setHeader("content-length", String(bytes.length));
      response.writeHead(200);
      response.end(request.method === "HEAD" ? undefined : bytes);
      audit("request", method, requestPath, 200);
    })().catch(() => {
      metrics.internalErrors += 1;
      audit("internal-error", request.method ?? "UNKNOWN", request.url ?? "", 500);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  };
}

async function readTlsFile(path: string, label: string): Promise<Buffer> {
  const resolvedPath = resolve(path);
  const info = await lstat(resolvedPath).catch((error: unknown) => {
    throw new AibaError(`Cannot read ${label}`, "TLS_FILE_NOT_FOUND", { cause: error });
  });
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_TLS_FILE_SIZE) {
    throw new AibaError(`${label} must be a size-bounded regular file`, "INVALID_TLS_FILE");
  }
  if (label === "TLS private key" && process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new AibaError("TLS private key must not be group or world accessible", "INSECURE_TLS_KEY_PERMISSIONS");
  }
  return readFile(resolvedPath);
}

export async function createRegistryServer(
  options: RegistryServerOptions,
): Promise<CreatedRegistryServer> {
  if (
    !options.token
    || options.token.length > MAX_TOKEN_SIZE
    || /[\u0000-\u001f\u007f]/.test(options.token)
  ) {
    throw new AibaError("Registry bearer token is missing or invalid", "REGISTRY_TOKEN_INVALID");
  }
  if ((options.tlsCertificatePath === undefined) !== (options.tlsPrivateKeyPath === undefined)) {
    throw new AibaError("TLS certificate and private key must be provided together", "INCOMPLETE_TLS_CONFIG");
  }
  if (
    options.requestLimitPerMinute !== undefined
    && (!Number.isSafeInteger(options.requestLimitPerMinute)
      || options.requestLimitPerMinute < 1
      || options.requestLimitPerMinute > 1_000_000)
  ) {
    throw new AibaError("Registry request limit must be between 1 and 1000000", "INVALID_REGISTRY_REQUEST_LIMIT");
  }
  const root = resolve(options.registryDirectory);
  const verified = await buildVerifiedRoutes(options);
  const metrics: RegistryServerMetrics = {
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    requests: 0,
    unauthorized: 0,
    rateLimited: 0,
    internalErrors: 0,
  };
  const listener = requestListener(
    root,
    options.token,
    verified.routes,
    verified.latest,
    verified.snapshot,
    options,
    metrics,
  );
  if (options.tlsCertificatePath && options.tlsPrivateKeyPath) {
    const [cert, key] = await Promise.all([
      readTlsFile(options.tlsCertificatePath, "TLS certificate"),
      readTlsFile(options.tlsPrivateKeyPath, "TLS private key"),
    ]);
    return {
      server: createHttpsServer({ cert, key }, listener),
      snapshot: verified.snapshot,
      secure: true,
      metrics,
    };
  }
  return {
    server: createHttpServer(listener),
    snapshot: verified.snapshot,
    secure: false,
    metrics,
  };
}
