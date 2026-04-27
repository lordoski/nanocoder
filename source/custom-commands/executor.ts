import {substituteTemplateVariables} from '@/custom-commands/parser';
import type {CustomCommand, CustomCommandParameter} from '@/types/index';
import {parseArgs} from './param-parser';

export interface ResolvedParam {
	name: string;
	value: string;
}

export interface ExecutionResult {
	/** The fully built prompt ready to send to the LLM. */
	prompt: string;
	/** Compact display of command + mapped args for echo back to user. */
	echoedArgs: string;
	/** Name-value pairs resolved from user input. */
	resolvedParameters: ResolvedParam[];
}

/**
 * Extract the parameter name from a mixed string | object entry.
 */
function getParamName(
	param: string | CustomCommandParameter,
	index: number,
): string {
	if (typeof param === 'string') {
		return param;
	}
	return (param as CustomCommandParameter).name ?? `p${index}`;
}

/**
 * Build the execution context block that precedes the original command content.
 */
function buildExecutionContextBlock(
	commandName: string,
	params: ResolvedParam[],
): string {
	const lines = [
		'--- EXECUTION CONTEXT ---',
		`Command: /${commandName}`,
		`Arguments received: ${params.length}`,
	];

	for (const p of params) {
		lines.push(`- ${p.name}: ${p.value}`);
	}

	lines.push('');
	return lines.join('\n');
}

export class CustomCommandExecutor {
	/**
	 * Execute a custom command with given arguments (legacy API — simple split-based args).
	 */
	execute(command: CustomCommand, args: string[]): string {
		// Build template variables from parameters and arguments
		const variables: Record<string, string> = {};

		if (command.metadata.parameters && command.metadata.parameters.length > 0) {
			// Map arguments to parameters
			command.metadata.parameters.forEach((param, index: number) => {
				const name = getParamName(param, index);
				variables[name] = args[index] || '';
			});

			// Also provide all args as a single variable
			variables['args'] = args.join(' ');
		}

		// Add some default context variables
		variables['cwd'] = process.cwd();
		variables['command'] = command.fullName;

		// Substitute variables in the command content
		const promptContent = substituteTemplateVariables(
			command.content,
			variables,
		);

		// Build the full prompt
		let fullPrompt = `[Executing custom command: /${command.fullName}]\n\n${promptContent}`;

		// Append resource information if available
		if (command.loadedResources?.length) {
			fullPrompt += '\n\n[Available resources:';
			for (const r of command.loadedResources) {
				fullPrompt += `\n  - ${r.name} (${r.type})`;
			}
			fullPrompt += ']';
		}

		fullPrompt +=
			'\n\n[Note: If this custom command could be improved, please provide feedback on how to enhance it.]';

		// Execute the prompt as if the user typed it
		return fullPrompt;
	}

	/**
	 * Execute a custom command with quote-aware argument parsing.
	 *
	 * Tokenizes raw input respecting quotes, maps only the first N tokens to
	 * N defined parameters, builds an execution context block prepended to
	 * the original .md content, and returns echo-friendly metadata.
	 */
	executeWithParams(command: CustomCommand, rawInput: string): ExecutionResult {
		// 1. Parse all tokens from input (quote-aware)
		const parsed = parseArgs(rawInput);

		// 2. Get expected count from command metadata
		const paramDefs = command.metadata.parameters ?? [];
		const paramCount = paramDefs.length;

		// 3. Map tokens to params (or use all tokens if no params defined)
		let mappedTokens: string[];
		if (paramCount > 0) {
			mappedTokens = parsed.allTokens.slice(0, paramCount);
		} else {
			mappedTokens = parsed.allTokens;
		}

		// 4. Build resolved parameter list
		const resolvedParameters: ResolvedParam[] = mappedTokens.map((val, i) => {
			if (paramCount > 0 && paramDefs[i]) {
				return {name: getParamName(paramDefs[i], i), value: val};
			}
			return {name: `p${i}`, value: val};
		});

		// 5. Build template variables for substitution in command content
		const variables: Record<string, string> = {};
		for (const p of resolvedParameters) {
			variables[p.name] = p.value;
		}
		variables['args'] = mappedTokens.join(' ');
		variables['cwd'] = process.cwd();
		variables['command'] = command.fullName;

		// Substitute variables in the command content
		const promptContent = substituteTemplateVariables(
			command.content,
			variables,
		);

		// 6. Build execution context section
		const ctxBlock = buildExecutionContextBlock(
			command.fullName,
			resolvedParameters,
		);

		// 7. Combine into final prompt
		let fullPrompt = `${ctxBlock}${promptContent}`;

		fullPrompt +=
			'\n\n------------------------\nExecute this command with the provided arguments.\n--- END CONTEXT ---';

		// Append resource information if available
		if (command.loadedResources?.length) {
			fullPrompt += '\n\n[Available resources:';
			for (const r of command.loadedResources) {
				fullPrompt += `\n  - ${r.name} (${r.type})`;
			}
			fullPrompt += ']';
		}

		// 8. Build echo string: "commandName arg1 arg2 ..."
		const echoedArgs = [command.fullName, ...mappedTokens].join(' ');

		return {
			prompt: fullPrompt,
			echoedArgs,
			resolvedParameters,
		};
	}

	/**
	 * Format command help text
	 */
	formatHelp(command: CustomCommand): string {
		const parts: string[] = [`/${command.fullName}`];

		if (command.metadata.parameters && command.metadata.parameters.length > 0) {
			parts.push(
				command.metadata.parameters
					.map((p, i) => `<${getParamName(p, i)}>`)
					.join(' '),
			);
		}

		if (command.metadata.description) {
			parts.push(`- ${command.metadata.description}`);
		}

		if (command.metadata.aliases && command.metadata.aliases.length > 0) {
			const aliasNames = command.metadata.aliases.map(a =>
				command.namespace ? `${command.namespace}:${a}` : a,
			);
			parts.push(`(aliases: ${aliasNames.join(', ')})`);
		}

		return parts.join(' ');
	}
}
