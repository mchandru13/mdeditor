/**
 * Minimal safety check for SVG produced by Mermaid.
 *
 * Mermaid runs with `securityLevel: 'strict'`, which escapes label HTML. This is
 * a second line of defence for the failure modes that would matter if that
 * setting were bypassed: script elements, embedded browsing contexts, event
 * handler attributes and `javascript:` URLs in link or image attributes.
 *
 * `foreignObject` is deliberately allowed: Mermaid renders flowchart labels
 * through it, so rejecting it would refuse every ordinary diagram. Its contents
 * are covered by the other rules and by the CSP.
 *
 * The URL pattern is anchored to an attribute so that a label reading
 * "javascript: the good parts" is not mistaken for an attack.
 */

const UNSAFE_SVG =
  /<script|<iframe|<object|<embed|\bsrcdoc\s*=|\bon(?:load|error|click|mouseover|begin|end)\s*=|\b(?:href|src|xlink:href)\s*=\s*["']?\s*javascript:/i;

export function isSafeSvg(svg: string): boolean {
  return !UNSAFE_SVG.test(svg);
}
