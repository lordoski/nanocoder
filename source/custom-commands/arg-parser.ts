/**
 * Tokenize input respecting single/double quotes.
 * Handles shell-style quoting where quoted strings preserve spaces.
 */
export function parseArgs(input: string): string[] {
	const tokens: string[] = [];
	let currentToken = '';
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < input.length; i++) {
		const char = input[i];

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
		} else if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
			if (currentToken.length > 0) {
				tokens.push(currentToken);
				currentToken = '';
			}
		} else {
			currentToken += char;
		}
	}

	// Push the last token if any
	if (currentToken.length > 0) {
		tokens.push(currentToken);
	}

	return tokens;
}
