// Dev-only mock of Logto's JWKS endpoint, for exercising the guest→account
// attachment flow (/games-attach) without real credentials: generates an
// RSA keypair, serves the public key at /oidc/jwks on :3210, and prints an
// access token signed with the private key.
//
//   node web/scripts/mock-logto.mjs [sub]
//
// Then restart the dev server with:
//   LOGTO_ENDPOINT=http://localhost:3210
//   LOGTO_RESOURCE=https://api.skinbattle.lol
// and POST the printed token to /games-attach. This runs the production
// verification path (jose + remote JWKS + iss/aud checks) end-to-end — no
// bypass code anywhere.
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const sub = process.argv[2] ?? 'mock-sub-1'
const resource = process.env.LOGTO_RESOURCE ?? 'https://api.skinbattle.lol'
const issuer = 'http://localhost:3210/oidc'

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
Object.assign(jwk, { kid: 'mock', alg: 'RS256', use: 'sig' })

const token = await new SignJWT({})
  .setProtectedHeader({ alg: 'RS256', kid: 'mock' })
  .setIssuer(issuer)
  .setAudience(resource)
  .setSubject(sub)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(privateKey)

console.log(`TOKEN ${token}`)

createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ keys: [jwk] }))
}).listen(3210, () => console.log('mock Logto JWKS listening on :3210'))
