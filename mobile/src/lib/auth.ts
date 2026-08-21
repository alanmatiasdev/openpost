import { clearToken, saveToken } from "./api/token-store";
import { api, errorMessage } from "./api/client";

export type LoginResult =
  | { kind: "signed-in" }
  | { kind: "mfa"; mfaToken: string; methods: string[] }
  | { kind: "email-verification" };

export async function login(email: string, password: string): Promise<LoginResult> {
  const { data, error, response } = await api().POST("/auth/login", {
    body: { email, password },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Sign in failed"));
  if (data.requires_mfa) {
    return {
      kind: "mfa",
      mfaToken: data.mfa_token ?? "",
      methods: data.mfa_methods ?? ["totp"],
    };
  }
  if (data.requires_email_verification) return { kind: "email-verification" };
  if (!data.token) throw new Error("Sign in did not return a session");
  await saveToken(data.token);
  return { kind: "signed-in" };
}

export async function verifyTotp(mfaToken: string, code: string): Promise<void> {
  const { data, error, response } = await api().POST("/auth/login/totp", {
    body: { mfa_token: mfaToken, code },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Invalid code"));
  if (!data.token) throw new Error("Verification did not return a session");
  await saveToken(data.token);
}

export type PairingState = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
};

export type PairPoll =
  | { status: "pending"; intervalMs: number }
  | { status: "approved" }
  | { status: "denied" }
  | { status: "expired" };

export async function startPairing(clientName = "OpenPost mobile"): Promise<PairingState> {
  const { data, error, response } = await api().POST("/cli/auth/start", {
    body: {
      client_name: clientName,
      client_os: "mobile",
      client_version: "0.1.0",
    },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Could not start pairing"));
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
  };
}

export async function pollPairing(deviceCode: string): Promise<PairPoll> {
  const { data, error, response } = await api().POST("/cli/auth/poll", {
    body: { device_code: deviceCode },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Pairing check failed"));
  switch (data.status) {
    case "authorization_pending":
      return { status: "pending", intervalMs: (data.interval ?? 5) * 1000 };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    default:
      if (data.token) {
        await saveToken(data.token);
        return { status: "approved" };
      }
      return { status: "pending", intervalMs: (data.interval ?? 5) * 1000 };
  }
}

export async function signOut(): Promise<void> {
  try {
    await api().POST("/auth/logout", { body: {} as never });
  } catch {
    // Best effort; local session is cleared regardless.
  }
  await clearToken();
}
