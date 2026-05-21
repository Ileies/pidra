// Strip HTML to clean plain text suitable for LLM extraction.
// Removes: style, script, images, tracking pixels, unsubscribe footers.
export function stripHtml(html: string): string {
  return html
    // Remove style and script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Remove img tags
    .replace(/<img[^>]*>/gi, "")
    // Convert common block elements to newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    // Collapse runs of whitespace/blank lines
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Remove common newsletter footer boilerplate to reduce token count.
export function removeFooter(text: string): string {
  const footerPatterns = [
    /unsubscribe.{0,200}$/im,
    /you('re| are) receiving this.{0,300}$/im,
    /to stop receiving.{0,200}$/im,
    /manage your (email )?preferences.{0,200}$/im,
    /copyright ©.{0,200}$/im,
    /view in browser.{0,100}/im,
    /was this forwarded.{0,200}/im,
  ];

  let result = text;
  for (const pattern of footerPatterns) {
    const match = result.match(pattern);
    if (match && match.index !== undefined && match.index > result.length * 0.6) {
      result = result.slice(0, match.index).trim();
    }
  }
  return result;
}

export function cleanEmailContent(html: string | undefined, text: string | undefined): string {
  let content = "";

  if (html) {
    content = stripHtml(html);
  } else if (text) {
    content = text;
  }

  content = removeFooter(content);

  // Truncate to 6000 chars to keep LLM calls cheap
  if (content.length > 6000) {
    content = content.slice(0, 6000) + "\n[truncated]";
  }

  return content;
}
