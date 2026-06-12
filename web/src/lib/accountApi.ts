// Client for Logto's Account API - the self-service endpoints under
// {endpoint}/api/my-account and {endpoint}/api/verifications. Logto serves
// these CORS-open, so the browser talks to auth.skinbattle.lol directly.
//
// Two token/verification rules drive every flow here:
// - Auth is the OPAQUE access token from getAccessToken() with NO resource
//   (useAuth().getAccountToken) - a resource-bound JWT is rejected.
// - Mutations on sign-in identifiers (password, email, social) additionally
//   need an identity proof: a verification record id (from a password check
//   or an email code to the CURRENT address) sent in the
//   `logto-verification-id` header. Records live ~10 minutes and are
//   reusable across operations within that window.

import { getPublicConfig } from './config'

export interface AccountInfo {
  id: string
  username?: string | null
  name?: string | null
  avatar?: string | null
  primaryEmail?: string | null
  hasPassword?: boolean
  // Keyed by connector target ('discord', 'google', ...).
  identities?: Record<string, { userId: string; details?: unknown }>
}

export interface VerificationRecord {
  verificationRecordId: string
  expiresAt?: string
}

export interface SocialVerification extends VerificationRecord {
  authorizationUri: string
}

// A connector available for linking, served by our own /account-connectors
// route (the Logto endpoint that lists them isn't CORS-open).
export interface SocialConnector {
  id: string
  target: string
  name: string
  logo?: string
  logoDark?: string
}

export interface AccountApiError extends Error {
  status: number
  code?: string
}

function endpoint(): string {
  return getPublicConfig().logtoEndpoint.replace(/\/$/, '')
}

async function request<T>(
  path: string,
  opts: {
    method?: string
    token: string
    verificationId?: string
    body?: unknown
  },
): Promise<T> {
  const { method = 'GET', token, verificationId, body } = opts

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (verificationId) headers['logto-verification-id'] = verificationId

  const res = await fetch(`${endpoint()}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return undefined as T

  let data: any = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.error)) || `Request failed (${res.status})`,
    ) as AccountApiError
    err.status = res.status
    if (data && typeof data.code === 'string') err.code = data.code
    throw err
  }

  return data as T
}

export const accountApi = {
  // ── account snapshot ────────────────────────────────────────────
  me: (token: string) => request<AccountInfo>('/my-account', { token }),

  // ── identity proof (the `logto-verification-id` header value) ───
  verifyPassword: (token: string, password: string) =>
    request<VerificationRecord>('/verifications/password', {
      method: 'POST',
      token,
      body: { password },
    }),

  // Send a code. To the CURRENT primary email it mints a user-bound record
  // usable as identity proof; to a NEW email it mints the record that
  // becomes `newIdentifierVerificationRecordId` when binding.
  requestEmailCode: (token: string, email: string) =>
    request<VerificationRecord>('/verifications/verification-code', {
      method: 'POST',
      token,
      body: { identifier: { type: 'email', value: email } },
    }),

  verifyEmailCode: (
    token: string,
    email: string,
    verificationId: string,
    code: string,
  ) =>
    request<{ verificationRecordId: string }>(
      '/verifications/verification-code/verify',
      {
        method: 'POST',
        token,
        body: {
          identifier: { type: 'email', value: email },
          verificationId,
          code,
        },
      },
    ),

  // ── password ────────────────────────────────────────────────────
  // verificationId may be omitted only for accounts with no password, no
  // email, and no phone (nothing to prove identity with yet).
  setPassword: (token: string, password: string, verificationId?: string) =>
    request<void>('/my-account/password', {
      method: 'POST',
      token,
      verificationId,
      body: { password },
    }),

  // ── primary email ───────────────────────────────────────────────
  setPrimaryEmail: (
    token: string,
    email: string,
    verificationId: string,
    newIdentifierVerificationRecordId: string,
  ) =>
    request<void>('/my-account/primary-email', {
      method: 'POST',
      token,
      verificationId,
      body: { email, newIdentifierVerificationRecordId },
    }),

  // ── social identities ───────────────────────────────────────────
  // 1) start: get the provider authorization URL (redirectUri must be
  //    registered in the provider's dev portal - see DEPLOY.md).
  startSocialVerification: (
    token: string,
    connectorId: string,
    redirectUri: string,
    state: string,
  ) =>
    request<SocialVerification>('/verifications/social', {
      method: 'POST',
      token,
      body: { connectorId, redirectUri, state },
    }),

  // 2) back from the provider: hand all callback query params (plus the
  //    same redirectUri) to Logto to finish the code exchange.
  verifySocialVerification: (
    token: string,
    verificationRecordId: string,
    connectorData: Record<string, string>,
  ) =>
    request<{ verificationRecordId: string }>('/verifications/social/verify', {
      method: 'POST',
      token,
      body: { verificationRecordId, connectorData },
    }),

  // 3) bind the verified identity to the account.
  linkIdentity: (
    token: string,
    verificationId: string,
    newIdentifierVerificationRecordId: string,
  ) =>
    request<void>('/my-account/identities', {
      method: 'POST',
      token,
      verificationId,
      body: { newIdentifierVerificationRecordId },
    }),

  unlinkIdentity: (token: string, target: string, verificationId: string) =>
    request<void>(`/my-account/identities/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      token,
      verificationId,
    }),
}
