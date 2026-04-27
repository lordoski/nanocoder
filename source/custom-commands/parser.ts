import {readFileSync} from 'fs';
import type {CustomCommandMetadata, ParsedCustomCommand} from '@/types/index';
import {logError} from '@/utils/message-queue';

/**
 * Set of frontmatter keys that are always parsed as arrays
 */
const ARRAY_KEYS = new Set([
	'aliases',
	'parameters',
	'tags',
	'triggers',
	'examples',
	'references',
	'dependencies',
]);

/**
 * Frontmatter keys whose array items can be objects (key-value pairs after the dash).
 */
const OBJECT_ARRAY_KEYS = new Set(['parameters']);

/**
 * Set of frontmatter keys that are parsed as numbers
 */
const NUMBER_KEYS = new Set(['estimated-tokens']);

/**
 * Parse a value that may be a JSON-style array or a single item.
 * Returns an array of strings.
 */
function parseArrayValue(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		const content = trimmed.slice(1, -1);
		return content
			.split(',')
			.map(s => s.trim().replace(/^["']|["']$/g, ''))
			.filter(s => s.length > 0);
	}
	const cleaned = trimmed.replace(/^["']|["']$/g, '');
	return cleaned ? [cleaned] : [];
}

/**
 * Enhanced YAML frontmatter parser with support for multi-line strings,
 * arrays, and all command/skill metadata fields.
 */
function parseEnhancedFrontmatter(frontmatter: string): CustomCommandMetadata {
	const raw: Record<string, unknown> = {};
	const lines = frontmatter.split('\n');
	let currentKey: string | null = null;
	let currentValue: string[] = [];
	let isMultiline = false;
	let indentLevel = 0;

	/**
	 * Track the base indentation level for current array items so we can detect
	 * when a sub-key belongs to an object item vs a new top-level key.
	 */
	let dashIndent = 0;
	let currentObjectItem: Record<string, string> | null = null;

	const storeValue = (key: string, value: string) => {
		const trimmedValue = value.trim();

		if (ARRAY_KEYS.has(key)) {
			raw[key] = parseArrayValue(trimmedValue);
		} else if (NUMBER_KEYS.has(key)) {
			const num = Number(trimmedValue);
			if (!Number.isNaN(num)) {
				raw[key] = num;
			}
		} else {
			raw[key] = trimmedValue.replace(/^["']|["']$/g, '');
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // Skip if line is undefined
		const trimmedLine = line.trim();
		const lineIndent = line.length - line.trimStart().length;

		// Skip empty lines and comments
		if (!trimmedLine || trimmedLine.startsWith('#')) {
			continue;
		}

		// If we're building an object array item, check for sub-properties
		if (currentObjectItem && currentKey && OBJECT_ARRAY_KEYS.has(currentKey)) {
			// Sub-property of the current object item (indented under the dash)
			if (lineIndent > dashIndent && !trimmedLine.startsWith('- ')) {
				const colonIdx = findColonOutsideQuotes(trimmedLine);
				if (colonIdx !== -1) {
					const subKey = trimmedLine.slice(0, colonIdx).trim();
					const subVal = trimmedLine
						.slice(colonIdx + 1)
						.trim()
						.replace(/^["']|["']$/g, '');
					currentObjectItem[subKey] = subVal;
				}
				continue;
			} else {
				// End of this object item — store it
				const arr = (raw[currentKey] as unknown[]) ?? [];
				arr.push(currentObjectItem);
				raw[currentKey] = arr;
				currentObjectItem = null;
			}
		}

		// Check for YAML dash syntax (array items)
		if (
			trimmedLine.startsWith('- ') &&
			currentKey &&
			ARRAY_KEYS.has(currentKey)
		) {
			dashIndent = lineIndent;
			const afterDash = trimmedLine.slice(2).trim();

			if (OBJECT_ARRAY_KEYS.has(currentKey)) {
				// Could be a simple string or the start of an object
				const colonIdx = findColonOutsideQuotes(afterDash);
				if (colonIdx !== -1) {
					// Object-style: "- name: file" → start building object
					const objKey = afterDash.slice(0, colonIdx).trim();
					const objVal = afterDash
						.slice(colonIdx + 1)
						.trim()
						.replace(/^["']|["']$/g, '');
					currentObjectItem = {[objKey]: objVal};
					continue;
				}
			}

			// Simple string item
			const arrayItem = afterDash.replace(/^["']|["']$/g, '');
			const arr = (raw[currentKey] as string[]) ?? [];
			arr.push(arrayItem);
			raw[currentKey] = arr;
			continue;
		}

		// Check for multi-line string indicators
		if (trimmedLine.endsWith('|') || trimmedLine.endsWith('>')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex !== -1) {
				currentKey = line.slice(0, colonIndex).trim();
				isMultiline = true;
				currentValue = [];
				indentLevel = 0;
				continue;
			}
		}

		// Handle multi-line content
		if (isMultiline && currentKey) {
			const lineIndent = line.length - line.trimStart().length;

			if (trimmedLine && indentLevel === 0) {
				indentLevel = lineIndent;
			}

			if (trimmedLine && lineIndent >= indentLevel) {
				currentValue.push(line.slice(indentLevel));
			} else if (trimmedLine && lineIndent < indentLevel) {
				// End of multi-line block
				const multilineContent = currentValue.join('\n').trim();
				storeValue(currentKey, multilineContent);
				isMultiline = false;
				currentKey = null;
				currentValue = [];
				indentLevel = 0;
				// Re-process this line as a regular key-value pair
				i--; // Reprocess current line
				continue;
			} else if (!trimmedLine) {
				currentValue.push('');
			}

			// If this is the last line, process the accumulated multi-line value
			if (i === lines.length - 1 && currentValue.length > 0) {
				const multilineContent = currentValue.join('\n').trim();
				storeValue(currentKey, multilineContent);
			}

			continue;
		}

		// Handle regular key-value pairs — find colon outside quotes
		const colonIndex = findColonOutsideQuotes(line);
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim();

		if (value) {
			storeValue(key, value);
			currentKey = key; // For potential array items following
		} else {
			currentKey = key; // Key with no immediate value, might have array items below
		}
	}

	// Flush any remaining object array item at end of frontmatter
	if (currentObjectItem && currentKey) {
		const arr = (raw[currentKey] as unknown[]) ?? [];
		arr.push(currentObjectItem);
		raw[currentKey] = arr;
	}

	return mapRawToMetadata(raw);
}

/**
 * Find the first colon that is not inside single or double quotes.
 */
function findColonOutsideQuotes(line: string): number {
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
		} else if (char === ':' && !inSingleQuote && !inDoubleQuote) {
			return i;
		}
	}

	return -1;
}

/**
 * Normalize a single raw parameter entry into a typed CustomCommandParameter.
 */
function normalizeParameter(
	raw: unknown,
): string | import('@/types/commands').CustomCommandParameter {
	if (typeof raw === 'string') {
		return raw;
	}
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		const name = String(obj.name ?? '');
		const type = obj.type === 'path' ? ('path' as const) : undefined;
		const required = Boolean(obj.required);
		const description = obj.description ? String(obj.description) : undefined;
		return {
			name,
			...(type && {type}),
			...(required && {required}),
			...(description && {description}),
		};
	}
	return '';
}

/**
 * Map raw parsed key-value pairs to typed CustomCommandMetadata.
 */
function mapRawToMetadata(raw: Record<string, unknown>): CustomCommandMetadata {
	const metadata: CustomCommandMetadata = {};

	if (raw.description) metadata.description = raw.description as string;
	if (raw.aliases) metadata.aliases = raw.aliases as string[];
	if (raw.parameters) {
		const params = raw.parameters as unknown[];
		metadata.parameters = params.map(normalizeParameter);
	}
	if (raw.tags) metadata.tags = raw.tags as string[];
	if (raw.triggers) metadata.triggers = raw.triggers as string[];
	if (typeof raw['estimated-tokens'] === 'number')
		metadata.estimatedTokens = raw['estimated-tokens'];
	if (raw.category) metadata.category = raw.category as string;
	if (raw.version) metadata.version = raw.version as string;
	if (raw.author) metadata.author = raw.author as string;
	if (raw.examples) metadata.examples = raw.examples as string[];
	if (raw.references) metadata.references = raw.references as string[];
	if (raw.dependencies) metadata.dependencies = raw.dependencies as string[];

	return metadata;
}

/**
 * Parse a markdown file with optional YAML frontmatter
 */
export function parseCommandFile(filePath: string): ParsedCustomCommand {
	const fileContent = readFileSync(filePath, 'utf-8');

	// Check for frontmatter
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = fileContent.match(frontmatterRegex);

	if (match && match[1] && match[2]) {
		// Parse YAML frontmatter
		const frontmatter = match[1];
		const content = match[2];
		let metadata: CustomCommandMetadata = {};

		try {
			metadata = parseEnhancedFrontmatter(frontmatter);
		} catch (error) {
			// If parsing fails, treat entire file as content
			logError(`Failed to parse frontmatter in ${filePath}: ${String(error)}`);
			return {
				metadata: {},
				content: fileContent,
			};
		}

		return {
			metadata,
			content: content.trim(),
		};
	}

	// No frontmatter, entire file is content
	return {
		metadata: {},
		content: fileContent.trim(),
	};
}

/**
 * Replace template variables in command content
 */
export function substituteTemplateVariables(
	content: string,
	variables: Record<string, string>,
): string {
	let result = content;

	// Replace {{variable}} patterns
	for (const [key, value] of Object.entries(variables)) {
		const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
		result = result.replace(pattern, value);
	}

	return result;
}
