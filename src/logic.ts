/**
 * Based on Matchbox
 * Matchbox https://gitlab.com/acefed/matchbox Copyright (c) 2022 Acefed MIT License
 */

import { btos, stob } from "./utils";

export async function getInbox(req: string) {
  const res = await fetch(req, {
    method: "GET",
    headers: { Accept: "application/activity+json" },
  });
  return res.json();
}

export async function postInbox(
  req: string,
  data: any,
  headers: { [key: string]: string },
) {
  const res = await fetch(req, {
    method: "POST",
    body: JSON.stringify(data),
    headers,
  });
  return res;
}

export async function signHeaders(
  res: any,
  strName: string,
  strHost: string,
  strInbox: string,
  privateKey: CryptoKey,
) {
  const strTime = new Date().toUTCString();
  const s = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(res)),
  );
  const s256 = btoa(btos(s));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    stob(
      `(request-target): post ${new URL(strInbox).pathname}\n` +
        `host: ${new URL(strInbox).hostname}\n` +
        `date: ${strTime}\n` +
        `digest: SHA-256=${s256}`,
    ),
  );
  const b64 = btoa(btos(sig));
  const headers = {
    Host: new URL(strInbox).hostname,
    Date: strTime,
    Digest: `SHA-256=${s256}`,
    Signature:
      `keyId="https://${strHost}/u/${strName}#main-key-v2",` +
      `algorithm="rsa-sha256",` +
      `headers="(request-target) host date digest",` +
      `signature="${b64}"`,
    Accept: "application/activity+json",
    "Content-Type": "application/activity+json",
    "Accept-Encoding": "gzip",
    "User-Agent": `ssg-ap-bridge/0.0.0 (+https://${strHost}/)`,
  };
  return headers;
}

export async function acceptFollow(
  strName: string,
  strHost: string,
  strInbox: string,
  y: any,
  privateKey: CryptoKey,
) {
  const strId = crypto.randomUUID();
  const res = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${strHost}/u/${strName}/s/${strId}`,
    type: "Accept",
    actor: `https://${strHost}/u/${strName}`,
    object: y,
  };
  const headers = await signHeaders(
    res,
    strName,
    strHost,
    strInbox,
    privateKey,
  );
  await postInbox(strInbox, res, headers);
}

export function markdownToHtml(md: string): string {
  let html = md.trim()
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // Convert markdown links [text](url) to HTML links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="nofollow noopener noreferrer">$1</a>')
  // Auto-link plain text HTTP/HTTPS URLs (avoiding URLs already converted inside HTML tags)
  html = html.replace(/(?<!href=")(?<!">)https?:\/\/[^\s<]+/g, (url) => {
    return `<a href="${url}" target="_blank" rel="nofollow noopener noreferrer">${url}</a>`
  })
  // Convert double asterisks to bold (<strong>)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // Convert single asterisks to italic (<em>)
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  // Convert newlines to breaks (<br />)
  html = html.split('\n').join('<br />')
  
  return `<p>${html}</p>`
}

export async function createNote(
  strId: string,
  strName: string,
  strHost: string,
  strInbox: string,
  y: string,
  privateKey: CryptoKey,
) {
  const strTime = new Date().toISOString().substring(0, 19) + "Z";
  const res = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${strHost}/u/${strName}/s/${strId}/activity`,
    type: "Create",
    actor: `https://${strHost}/u/${strName}`,
    published: strTime,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`https://${strHost}/u/${strName}/followers`],
    object: {
      id: `https://${strHost}/u/${strName}/s/${strId}`,
      type: "Note",
      attributedTo: `https://${strHost}/u/${strName}`,
      content: markdownToHtml(y),
      url: `https://${strHost}/u/${strName}/s/${strId}`,
      published: strTime,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      cc: [`https://${strHost}/u/${strName}/followers`],
    },
  };
  const headers = await signHeaders(
    res,
    strName,
    strHost,
    strInbox,
    privateKey,
  );
  await postInbox(strInbox, res, headers);
}

export async function deleteNote(
  strName: string,
  strHost: string,
  strInbox: string,
  y: string,
  privateKey: CryptoKey,
) {
  const strId = crypto.randomUUID();
  const res = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${strHost}/u/${strName}/s/${strId}/activity`,
    type: "Delete",
    actor: `https://${strHost}/u/${strName}`,
    object: {
      id: y,
      type: "Note",
    },
  };
  const headers = await signHeaders(
    res,
    strName,
    strHost,
    strInbox,
    privateKey,
  );
  await postInbox(strInbox, res, headers);
}

export async function fetchActor(
  actorUrl: string,
  strName: string,
  strHost: string,
  privateKey: CryptoKey,
): Promise<any> {
  const url = new URL(actorUrl);
  const strTime = new Date().toUTCString();
  const signatureString = `(request-target): get ${url.pathname}${url.search}\n` +
    `host: ${url.hostname}\n` +
    `date: ${strTime}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    stob(signatureString),
  );
  const b64 = btoa(btos(sig));

  const headers = {
    Host: url.hostname,
    Date: strTime,
    Signature:
      `keyId="https://${strHost}/u/${strName}#main-key-v2",` +
      `algorithm="rsa-sha256",` +
      `headers="(request-target) host date",` +
      `signature="${b64}"`,
    Accept: "application/activity+json, application/ld+json",
    "User-Agent": `ssg-ap-bridge/0.0.0 (+https://${strHost}/)`,
  };

  const res = await fetch(actorUrl, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch actor ${actorUrl}: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export function base64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return decodeURIComponent(escape(atob(base64)));
}

export function extractFirstLink(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s\)\"\'\>]+/);
  return match ? match[0] : null;
}


