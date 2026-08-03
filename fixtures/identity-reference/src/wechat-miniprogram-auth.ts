import { createHash } from "node:crypto";
import type {
  Principal,
  WechatMiniProgramLoginCommand,
  WechatMiniProgramLoginResult,
} from "aiba-spec";

export interface WechatProviderIdentity {
  openId: string;
  unionId?: string;
  sessionKey: string;
}

export interface WechatCodeProvider {
  exchange(code: string): Promise<WechatProviderIdentity>;
}

export interface WechatCodeReplayGate {
  consume(codeSha256: string): Promise<boolean>;
}

export interface WechatIdentityBinder {
  bind(
    input: {
      tenantId: string;
      openId: string;
      unionId?: string;
      sessionKey: string;
    },
    recordAudit: (principal: Principal) => Promise<void>,
  ): Promise<Principal>;
}

export interface WechatAuthenticationAudit {
  record(input: {
    action: "identity:authenticate-wechat-miniprogram";
    outcome: "succeeded" | "failed";
    reasonCode: string;
    tenantId: string;
    correlationId: string;
    principal?: Principal;
  }): Promise<void>;
}

export interface WechatMiniProgramAuthDependencies {
  provider: WechatCodeProvider;
  replay: WechatCodeReplayGate;
  binder: WechatIdentityBinder;
  audit: WechatAuthenticationAudit;
  now?: () => Date;
}

export interface WechatAuthenticationContext {
  tenantId: string;
  correlationId: string;
}

export class WechatMiniProgramAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "authentication-failed"
      | "invalid-context"
      | "invalid-request"
      | "replayed-code",
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "WechatMiniProgramAuthError";
  }
}

const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_KEY = /^[A-Za-z0-9+/=_-]{16,256}$/;

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseCommand(value: unknown): WechatMiniProgramLoginCommand | undefined {
  const input = object(value);
  if (
    !input
    || Object.keys(input).length !== 1
    || typeof input.code !== "string"
    || input.code.length < 8
    || input.code.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(input.code)
  ) return undefined;
  return { code: input.code };
}

function assertContext(context: WechatAuthenticationContext): void {
  if (
    typeof context.tenantId !== "string"
    || context.tenantId.length < 1
    || context.tenantId.length > 255
    || typeof context.correlationId !== "string"
    || context.correlationId.length < 8
    || context.correlationId.length > 255
  ) throw new WechatMiniProgramAuthError("Trusted authentication context is invalid", "invalid-context");
}

function validProviderIdentity(value: WechatProviderIdentity): boolean {
  return PROVIDER_ID.test(value.openId)
    && (value.unionId === undefined || PROVIDER_ID.test(value.unionId))
    && SESSION_KEY.test(value.sessionKey);
}

function validBoundPrincipal(principal: Principal, tenantId: string): boolean {
  return principal.type === "user"
    && typeof principal.subject === "string"
    && principal.subject.length >= 1
    && principal.subject.length <= 255
    && principal.tenantId === tenantId;
}

export function createWechatMiniProgramAuthService(
  dependencies: WechatMiniProgramAuthDependencies,
) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async authenticate(
      context: WechatAuthenticationContext,
      value: unknown,
    ): Promise<WechatMiniProgramLoginResult> {
      assertContext(context);
      const command = parseCommand(value);
      if (!command) {
        throw new WechatMiniProgramAuthError("WeChat authentication request is invalid", "invalid-request");
      }
      const codeSha256 = createHash("sha256").update(command.code).digest("hex");
      if (!await dependencies.replay.consume(codeSha256)) {
        await dependencies.audit.record({
          action: "identity:authenticate-wechat-miniprogram",
          outcome: "failed",
          reasonCode: "replayed-code",
          tenantId: context.tenantId,
          correlationId: context.correlationId,
        });
        throw new WechatMiniProgramAuthError("WeChat authentication failed", "replayed-code");
      }

      let providerIdentity: WechatProviderIdentity;
      try {
        providerIdentity = await dependencies.provider.exchange(command.code);
        if (!validProviderIdentity(providerIdentity)) throw new Error("invalid provider response");
      } catch (error) {
        await dependencies.audit.record({
          action: "identity:authenticate-wechat-miniprogram",
          outcome: "failed",
          reasonCode: "provider-rejected",
          tenantId: context.tenantId,
          correlationId: context.correlationId,
        });
        throw new WechatMiniProgramAuthError(
          "WeChat authentication failed",
          "authentication-failed",
          { cause: error },
        );
      }

      try {
        const principal = await dependencies.binder.bind({
          tenantId: context.tenantId,
          openId: providerIdentity.openId,
          ...(providerIdentity.unionId ? { unionId: providerIdentity.unionId } : {}),
          sessionKey: providerIdentity.sessionKey,
        }, async (boundPrincipal) => {
          if (!validBoundPrincipal(boundPrincipal, context.tenantId)) {
            throw new Error("identity binder returned an invalid principal");
          }
          await dependencies.audit.record({
            action: "identity:authenticate-wechat-miniprogram",
            outcome: "succeeded",
            reasonCode: "provider-identity-bound",
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            principal: boundPrincipal,
          });
        });
        if (!validBoundPrincipal(principal, context.tenantId)) {
          throw new Error("identity binder returned an invalid principal");
        }
        return { principal, issuedAt: now().toISOString() };
      } catch (error) {
        try {
          await dependencies.audit.record({
            action: "identity:authenticate-wechat-miniprogram",
            outcome: "failed",
            reasonCode: "identity-binding-failed",
            tenantId: context.tenantId,
            correlationId: context.correlationId,
          });
        } catch {
          // Authentication still fails closed when failure telemetry is unavailable.
        }
        throw new WechatMiniProgramAuthError(
          "WeChat authentication failed",
          "authentication-failed",
          { cause: error },
        );
      }
    },
  };
}
