import {substituteTemplateVariables} from '@/custom-commands/parser';
import type {CustomCommand, CustomCommandParameter} from '@/types/index';

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

export class CustomCommandExecutor {
	/**
	 * Execute a custom command with pre-tokenized arguments.
	 *
	 * Maps tokens to declared parameters by position, substitutes {{param}}
	 * placeholders in the command content via template variables, and returns
	 * the fully built prompt ready for the LLM.
	 */
	execute(command: CustomCommand, args: string[]): string {
		const paramDefs = command.metadata.parameters ?? [];
		const paramCount = paramDefs.length;

		// Limit tokens to declared param count (extra tokens are ignored)
		let mappedTokens: string[];
		if (paramCount > 0) {
			mappedTokens = args.slice(0, paramCount);
		} else {
			mappedTokens = args;
		}

		// Build template variables for substitution in command content
		const variables: Record<string, string> = {};
		for (let i = 0; i < mappedTokens.length; i++) {
			const name =
				paramCount > 0 && paramDefs[i]
					? getParamName(paramDefs[i], i)
					: `p${i}`;
			variables[name] = mappedTokens[i];
		}
		variables['args'] = mappedTokens.join(' ');
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

		return fullPrompt;
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
