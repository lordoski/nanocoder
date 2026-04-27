/**
 * Quote-aware argument tokenizer for custom commands.
 * Wraps the low-level shell-style parser from arg-parser, providing a
 * structured result compatible with command metadata schemas.
 */
import {parseArgs as tokenize} from '@/custom-commands/arg-parser';

export interface ParsedArgs {
	/** Every token extracted from the input string (may exceed defined params). */
	allTokens: string[];
}

/**
 * Tokenize raw user input respecting single/double quotes.
 *
 * Examples:
 *   "/hello"                        → []
 *   "/cmd arg1"                     → ["arg1"]
 *   '/cmd "a b"'                    → ["a b"]
 *   "/cmd 'a b' c"                  → ["a b", "c"]
 *   '/cmd "unclosed'                → ["unclosed"]  (lenient)
 */
export function parseArgs(input: string): ParsedArgs {
	const allTokens = tokenize(input);
	return {allTokens};
}
