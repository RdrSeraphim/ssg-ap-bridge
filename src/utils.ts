export function stob(s: string) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export function btos(b: ArrayBuffer) {
  return String.fromCharCode(...new Uint8Array(b))
}

export async function importprivateKey(pem: string) {
  pem = pem.trim()
  if (pem.startsWith('"')) pem = pem.slice(1)
  if (pem.endsWith('"')) pem = pem.slice(0, -1)
  pem = pem.trim()
  pem = pem.replace(/-----BEGIN [A-Z\s]+-----/i, '')
  pem = pem.replace(/-----END [A-Z\s]+-----/i, '')
  pem = pem.split('\\n').join('')
  pem = pem.split('\n').join('')
  pem = pem.split('\r').join('')
  pem = pem.replace(/\s/g, '') // remove all remaining spaces and tabs
  const der = stob(atob(pem))
  const r = await crypto.subtle.importKey(
    'pkcs8',
    der,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    true,
    ['sign']
  )
  return r
}

export async function privateKeyToPublicKey(key: CryptoKey) {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  if ('kty' in jwk) {
    delete jwk.d
    delete jwk.p
    delete jwk.q
    delete jwk.dp
    delete jwk.dq
    delete jwk.qi
    delete jwk.oth
    jwk.key_ops = ['verify']
  }
  const r = await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    true,
    ['verify']
  )
  return r
}

export async function exportPublicKey(key: CryptoKey) {
  const der = await crypto.subtle.exportKey('spki', key)
  if ('byteLength' in der) {
    let pemContents = btoa(btos(der))

    let pem = '-----BEGIN PUBLIC KEY-----\n'
    while (pemContents.length > 0) {
      pem += pemContents.substring(0, 64) + '\n'
      pemContents = pemContents.substring(64)
    }
    pem += '-----END PUBLIC KEY-----\n'
    return pem
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  middot: '·',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
}

export function decodeEntities(str: string): string {
  if (!str) return ''
  return str.replace(/&(#(?:\d+|x[0-9a-f]+)|[a-z0-9]+);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1].toLowerCase() === 'x'
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return !isNaN(code) ? String.fromCharCode(code) : match
    }
    const decoded = NAMED_ENTITIES[entity.toLowerCase()]
    return decoded !== undefined ? decoded : match
  })
}

