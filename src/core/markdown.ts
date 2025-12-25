/**
 * Markdown processing for speak CLI
 *
 * Two modes:
 * - plain: Strip markdown syntax to plain text
 * - smart: Convert markdown with emotion tags for headers
 */

export type MarkdownMode = "plain" | "smart";
export type CodeBlockMode = "read" | "skip" | "placeholder";

export interface ProcessOptions {
  mode: MarkdownMode;
  codeBlocks: CodeBlockMode;
}

/**
 * Process markdown text according to the specified options
 */
export function processMarkdown(
  text: string,
  options: ProcessOptions = { mode: "plain", codeBlocks: "read" }
): string {
  const { mode, codeBlocks } = options;

  // Step 1: Handle code blocks first (before other processing)
  let processed = handleCodeBlocks(text, codeBlocks);

  // Step 2: Process headers based on mode
  processed = processHeaders(processed, mode);

  // Step 3: Strip remaining markdown syntax
  processed = stripMarkdownSyntax(processed);

  // Step 4: Clean up whitespace
  processed = cleanWhitespace(processed);

  return processed;
}

/**
 * Handle fenced code blocks (```code```)
 */
function handleCodeBlocks(text: string, mode: CodeBlockMode): string {
  // Match fenced code blocks with optional language identifier
  const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/g;

  switch (mode) {
    case "skip":
      return text.replace(codeBlockRegex, "");
    case "placeholder":
      return text.replace(codeBlockRegex, "[code block omitted]");
    case "read":
    default:
      // Remove the fence markers but keep the code content
      return text.replace(codeBlockRegex, (_match, code) => code.trim());
  }
}

/**
 * Process headers based on mode
 * - plain: Strip # markers
 * - smart: Add emotion tags before headers
 */
function processHeaders(text: string, mode: MarkdownMode): string {
  // Match headers (# through ######)
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;

  return text.replace(headerRegex, (_match, hashes, content) => {
    const trimmedContent = content.trim();

    if (mode === "smart") {
      // Add [clear throat] before headers for emphasis
      return `[clear throat] ${trimmedContent}`;
    } else {
      // Plain mode: just the content
      return trimmedContent;
    }
  });
}

/**
 * Strip common markdown syntax
 */
function stripMarkdownSyntax(text: string): string {
  let result = text;

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Images: ![alt](url) → (remove entirely or keep alt)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

  // Bold: **text** or __text__ → text
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");

  // Italic: *text* or _text_ → text
  // Be careful not to match * in middle of words
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");

  // Strikethrough: ~~text~~ → text
  result = result.replace(/~~([^~]+)~~/g, "$1");

  // Inline code: `code` → code
  result = result.replace(/`([^`]+)`/g, "$1");

  // Blockquotes: > text → text
  result = result.replace(/^>\s+/gm, "");

  // Horizontal rules: ---, ***, ___ → (remove)
  result = result.replace(/^[-*_]{3,}$/gm, "");

  // Unordered lists: - item or * item → item
  result = result.replace(/^[-*+]\s+/gm, "");

  // Ordered lists: 1. item → item
  result = result.replace(/^\d+\.\s+/gm, "");

  // Task lists: - [ ] or - [x] → (remove checkbox)
  result = result.replace(/^[-*+]\s+\[[ xX]\]\s+/gm, "");

  // HTML tags: <tag> or </tag> → (remove)
  result = result.replace(/<\/?[^>]+>/g, "");

  // HTML entities: &nbsp; &amp; etc → space
  result = result.replace(/&\w+;/g, " ");

  // Reference-style links: [text][ref] → text
  result = result.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Link definitions: [ref]: url → (remove)
  result = result.replace(/^\[[^\]]+\]:\s+.+$/gm, "");

  return result;
}

/**
 * Clean up whitespace for natural reading
 */
function cleanWhitespace(text: string): string {
  let result = text;

  // Replace multiple newlines with double newline (paragraph break)
  result = result.replace(/\n{3,}/g, "\n\n");

  // Replace multiple spaces with single space
  result = result.replace(/[ \t]+/g, " ");

  // Trim each line
  result = result
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  // Remove leading/trailing whitespace
  result = result.trim();

  return result;
}

/**
 * Detect if text appears to be markdown
 */
export function isMarkdown(text: string): boolean {
  // Check for common markdown patterns
  const patterns = [
    /^#{1,6}\s+/m, // Headers
    /\[.+\]\(.+\)/, // Links
    /```[\s\S]+```/, // Code blocks
    /^\s*[-*+]\s+/m, // Unordered lists
    /^\s*\d+\.\s+/m, // Ordered lists
    /\*\*[^*]+\*\*/, // Bold
  ];

  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Extract first sentence for preview mode
 */
export function extractFirstSentence(text: string): string {
  // First, get the first paragraph (up to double newline)
  const firstPara = text.split(/\n\n/)[0].trim();

  // Match sentence ending with . ! ? followed by space, newline, or end
  const sentenceEndRegex = /^(.+?[.!?])(?:\s|$)/;
  const match = firstPara.match(sentenceEndRegex);

  if (match) {
    return match[1].trim();
  }

  // If no sentence ending, use the first paragraph (likely a header)
  if (firstPara.length <= 100) {
    return firstPara;
  }

  // Fallback: first 100 characters
  return firstPara.slice(0, 100).trim() + "...";
}
