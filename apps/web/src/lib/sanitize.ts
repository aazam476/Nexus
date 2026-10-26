// Turns untrusted email HTML into a document that is safe to show in a sandboxed iframe.
// Three layers: DOMPurify strips scripts/handlers, the CSP blocks anything that slips through,
// and the iframe sandbox (no allow-scripts) stops script execution entirely.
import DOMPurify from 'dompurify'

export interface SafeEmail {
  html: string
  blockedImages: number
}

export function buildSafeEmailDocument(dirtyHtml: string, allowRemoteImages: boolean): SafeEmail {
  let blockedImages = 0

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Links open in a new tab and never leak the Nexus URL.
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    // Remote images are tracking pixels until the user says otherwise.
    if (!allowRemoteImages && node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? ''
      if (/^https?:/i.test(src)) {
        node.setAttribute('data-blocked-src', src)
        node.removeAttribute('src')
        blockedImages++
      }
    }
  })

  const clean = DOMPurify.sanitize(dirtyHtml, {
    FORBID_TAGS: [
      'style',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
    ],
    FORBID_ATTR: ['srcset', 'background', 'action', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
  DOMPurify.removeHook('afterSanitizeAttributes')

  const imgSrc = allowRemoteImages ? 'data: cid: https:' : 'data: cid:'
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:;`

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html { overflow: hidden; }
  body { margin: 0; padding: 20px; font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: #1b1b22; background: #fff; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  img[data-blocked-src] { display: none; }
  table { max-width: 100%; }
  a { color: #3f47d6; }
</style></head><body>${clean}</body></html>`

  return { html, blockedImages }
}

// For HTML shown directly in the app (not in the sandbox): signatures and drafts loaded into an editor.
// A shared account's signature can be edited by other people, so it is never trusted as-is.
export function sanitizeForEditor(dirtyHtml: string): string {
  return DOMPurify.sanitize(dirtyHtml, {
    FORBID_TAGS: [
      'style',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-signature'], // marks where the signature starts, see compose.ts
  })
}
