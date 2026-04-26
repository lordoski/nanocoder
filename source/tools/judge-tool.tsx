import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {AISDKClient} from '@/ai-sdk-client';
import type {JudgeConfig} from '@/config/index';
import {loadJudgeConfig} from '@/config/index';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {AIProviderConfig, Message} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

const execAsync = promisify(exec);

interface JudgeArgs {
	mode?: 'full' | 'task';
	taskId?: string;
}

interface CriterionResult {
	criterion: string;
	passed: boolean;
	reason: string;
}

interface JudgeResponse {
	task_id: string;
	results: CriterionResult[];
	allPassed: boolean;
}

interface TaskValidationResult {
	taskId: string;
	taskTitle: string;
	criteriaResults: CriterionResult[];
	allPassed: boolean;
	failedCriteria: string[];
}

/**
 * Read a file and return its content (or error message).
 */
async function readFileContent(path: string): Promise<string> {
	try {
		const {readFile} = await import('node:fs/promises');
		return await readFile(path, 'utf-8');
	} catch (error) {
		return `ERROR reading ${path}: ${formatError(error)}`;
	}
}

/**
 * Run a shell command and return its output (or error message).
 */
async function runCommand(command: string, timeoutMs: number): Promise<string> {
	try {
		const result = await execAsync(command, {timeout: timeoutMs});
		return result.stdout || '(no output)';
	} catch (error: unknown) {
		const err = error as {stderr?: string; stdout?: string; message?: string};
		const stderr = err.stderr ? `\nSTDERR: ${err.stderr.trim()}` : '';
		return `COMMAND FAILED: ${command}${stderr}\n${err.message ?? String(error)}`;
	}
}

/**
 * Build the evidence prompt for a single task by gathering file contents
 * and running relevant commands based on the acceptance criteria.
 */
function buildEvidencePrompt(task: Task): string {
	const criteriaList = (task.acceptanceCriteria ?? [])
		.map((c, i) => `${i + 1}. ${c}`)
		.join('\n');

	return [
		`TASK: ${task.title}`,
		task.description ? `DESCRIPTION: ${task.description}` : '',
		`ACCEPTANCE CRITERIA:\n${criteriaList}`,
	]
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Parse the judge LLM response into structured results.
 */
function parseJudgeResponse(
	content: string,
	defaultTaskId: string,
): JudgeResponse {
	try {
		// Try to extract JSON from the response (may include markdown code blocks)
		let jsonStr = content.trim();

		// Remove markdown code fences if present
		const fenceMatch = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
		if (fenceMatch) {
			jsonStr = fenceMatch[1].trim();
		}

		const parsed = JSON.parse(jsonStr) as Partial<JudgeResponse>;

		return {
			task_id: parsed.task_id ?? defaultTaskId,
			results: Array.isArray(parsed.results)
				? parsed.results.map(r => ({
						criterion: r.criterion ?? 'Unknown',
						passed: Boolean(r.passed),
						reason: r.reason ?? '',
					}))
				: [],
			allPassed:
				typeof parsed.allPassed === 'boolean' ? parsed.allPassed : false,
		};
	} catch {
		// Fallback: treat entire response as a single failure reason
		return {
			task_id: defaultTaskId,
			results: [
				{
					criterion: '(could not parse judge response)',
					passed: false,
					reason: content.slice(0, 500),
				},
			],
			allPassed: false,
		};
	}
}

/**
 * Build the system prompt for the judge LLM.
 */
function getJudgeSystemPrompt(): string {
	return `You are an expert code reviewer evaluating whether completed tasks meet their acceptance criteria. 
For each criterion, you will be given evidence gathered from the codebase (file contents, command outputs). 
Evaluate objectively and provide clear pass/fail results with explanations.`;
}

/**
 * Validate a single task using the configured LLM provider.
 */
async function validateSingleTask(
	task: Task,
	client: Awaited<ReturnType<typeof AISDKClient.create>>,
	timeoutMs: number,
): Promise<TaskValidationResult> {
	const criteria = task.acceptanceCriteria ?? [];
	if (criteria.length === 0) {
		return {
			taskId: task.id,
			taskTitle: task.title,
			criteriaResults: [],
			allPassed: true,
			failedCriteria: [],
		};
	}

	// Gather evidence: read files mentioned in criteria, run commands
	const evidenceParts: string[] = [];

	for (const criterion of criteria) {
		// Try to detect file paths in the criterion
		const fileMatches = criterion.match(
			/['"]?([a-zA-Z][\w\-\.\/]*\.\w+)['"]?/g,
		);
		if (fileMatches) {
			for (const match of fileMatches.slice(0, 3)) {
				const path = match.replace(/^['"]|['"]$/g, '');
				evidenceParts.push(`--- FILE: ${path} ---`);
				evidenceParts.push(await readFileContent(path));
			}
		}

		// Try to detect shell commands (patterns like \`command\`, $(command), or "Run X")
		const commandMatch = criterion.match(/`([^`\n]+)`/g);
		if (commandMatch) {
			for (const match of commandMatch.slice(0, 2)) {
				const cmd = match.replace(/`/g, '').trim();
				if (cmd && !cmd.includes('.')) {
					// Likely a command, not a path
					evidenceParts.push(`--- COMMAND OUTPUT: ${cmd} ---`);
					evidenceParts.push(await runCommand(cmd, timeoutMs));
				}
			}
		}
	}

	// If no evidence was gathered automatically, provide directory listing as context
	if (evidenceParts.length === 0) {
		try {
			const lsOutput = await runCommand('ls -la', timeoutMs);
			evidenceParts.push(`--- DIRECTORY LISTING ---`);
			evidenceParts.push(lsOutput);
		} catch {
			evidenceParts.push('(could not gather directory listing)');
		}
	}

	const taskContext = buildEvidencePrompt(task);
	const evidence = evidenceParts.join('\n\n');

	const userMessage: Message = {
		role: 'user',
		content: [
			taskContext,
			'',
			'GATHERED EVIDENCE:',
			evidence,
			'',
			'EVALUATE EACH CRITERION AGAINST THE EVIDENCE ABOVE.',
			'RESPOND ONLY IN THIS JSON FORMAT (wrap in ```json code block):',
			'{',
			'  "task_id": "' + task.id + '",',
			'  "results": [',
			'    {"criterion": "...", "passed": true/false, "reason": "..."}',
			'  ],',
			'  "allPassed": true/false',
			'}',
		].join('\n'),
	};

	try {
		const response = await client.chat(
			[{role: 'system', content: getJudgeSystemPrompt()}, userMessage],
			{}, // No tools needed for judge evaluation
			{onFinish: () => {}},
			undefined,
			undefined,
		);

		if (!response.choices?.[0]?.message) {
			throw new Error('Empty response from judge LLM');
		}

		const content = response.choices[0].message.content ?? '';
		const parsed = parseJudgeResponse(content, task.id);

		return {
			taskId: task.id,
			taskTitle: task.title,
			criteriaResults: parsed.results,
			allPassed: parsed.allPassed,
			failedCriteria: parsed.results
				.filter(r => !r.passed)
				.map(r => r.criterion),
		};
	} catch (error) {
		return {
			taskId: task.id,
			taskTitle: task.title,
			criteriaResults: criteria.map(c => ({
				criterion: c,
				passed: false,
				reason: `Judge error: ${formatError(error)}`,
			})),
			allPassed: false,
			failedCriteria: criteria,
		};
	}
}

/**
 * Create an LLM client for the judge's configured provider.
 */
async function createJudgeClient(
	config: JudgeConfig,
): Promise<Awaited<ReturnType<typeof AISDKClient.create>>> {
	const providers = loadAllProviderConfigs();
	const targetProvider = providers.find(p => p.name === config.provider.name);

	if (!targetProvider) {
		throw new Error(
			`Judge provider '${config.provider.name}' not found in agents.config.json`,
		);
	}

	// Build AI SDK provider config from loaded provider config
	const aiProviderConfig: AIProviderConfig = {
		name: targetProvider.name,
		type: 'openai',
		models: targetProvider.models || [],
		contextWindow: targetProvider.contextWindow,
		requestTimeout: targetProvider.requestTimeout,
		sdkProvider: targetProvider.sdkProvider,
		config: {
			baseURL: targetProvider.baseUrl,
			apiKey: targetProvider.apiKey || 'dummy-key',
			headers: targetProvider.headers ?? {},
		},
	};

	const client = await AISDKClient.create(aiProviderConfig);
	client.setModel(config.provider.model);
	return client;
}

/**
 * Format the validation results for display to the agent.
 */
function formatResults(results: TaskValidationResult[]): string {
	const allPassed = results.every(r => r.allPassed);

	if (results.length === 0) {
		return '<result>APPROVED</result>\nNo completed tasks with acceptance criteria found.';
	}

	if (allPassed) {
		return `<result>APPROVED</result>\n\nAll ${results.length} task(s) passed their acceptance criteria.`;
	}

	// Build failure report showing only failed criteria
	const lines: string[] = ['## JUDGE REPORT - VALIDATION FAILED'];
	lines.push('');

	for (const result of results) {
		if (!result.allPassed) {
			lines.push(`### Task: ${result.taskTitle}`);
			lines.push('');
			lines.push('**Failed Criteria:**');
			for (const criterion of result.criteriaResults.filter(c => !c.passed)) {
				lines.push(`- \`${criterion.criterion}\``);
				lines.push(`  Reason: ${criterion.reason}`);
				lines.push('');
			}
		}
	}

	lines.push('---');
	lines.push(
		'To fix failures, review the above criteria and verify each against the codebase.',
	);
	lines.push(
		'Run relevant commands mentioned in acceptance criteria to confirm state.',
	);

	return lines.join('\n');
}

/**
 * Main judge execution function.
 */
async function executeJudge(args: JudgeArgs): Promise<string> {
	const config = loadJudgeConfig();
	if (!config) {
		return 'Judge is not enabled or misconfigured. Add a "judge" section to agents.config.json.';
	}

	let tasksToValidate: Task[];

	if (args.mode === 'task') {
		if (!args.taskId?.trim()) {
			return 'Error: taskId is required when mode is "task".';
		}
		const allTasks = await loadTasks();
		const task = allTasks.find(t => t.id === args.taskId);
		if (!task) {
			return `Task '${args.taskId}' not found.`;
		}
		tasksToValidate = [task];
	} else {
		// Default: full mode - validate all completed tasks
		const allTasks = await loadTasks();
		tasksToValidate = allTasks.filter(t => t.status === 'completed');
	}

	// Filter to only tasks with acceptance criteria
	const tasksWithCriteria = tasksToValidate.filter(
		t => t.acceptanceCriteria && t.acceptanceCriteria.length > 0,
	);

	if (tasksWithCriteria.length === 0) {
		return '<result>APPROVED</result>\nNo completed tasks with acceptance criteria to validate.';
	}

	// Create judge LLM client
	let client: Awaited<ReturnType<typeof AISDKClient.create>>;
	try {
		client = await createJudgeClient(config);
	} catch (error) {
		return `Failed to initialize judge provider: ${formatError(error)}. Verify the provider and model in agents.config.json.`;
	}

	const timeoutMs = config.options.timeoutMs ?? 60000;
	const results: TaskValidationResult[] = [];

	// Validate each task sequentially
	for (const task of tasksWithCriteria) {
		const result = await validateSingleTask(task, client, timeoutMs);
		results.push(result);
	}

	return formatResults(results);
}

const judgeCoreTool = tool({
	description:
		'Validate all completed tasks against their acceptance criteria. Uses the configured LLM provider to evaluate each criterion by reading files and running commands as specified.',
	inputSchema: jsonSchema<JudgeArgs>({
		type: 'object',
		properties: {
			mode: {
				type: 'string',
				enum: ['full', 'task'],
				description:
					'"full" validates all completed tasks, "task" validates a single task',
			},
			taskId: {
				type: 'string',
				description: 'Required when mode is "task"',
			},
		},
		required: [],
	}),
	needsApproval: true,
	execute: async (args, _options) => {
		return await executeJudge(args);
	},
});

export const judgeTool: NanocoderToolExport = {
	name: 'judge' as const,
	tool: judgeCoreTool,
};
