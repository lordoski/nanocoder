import test from 'ava';
import type {CustomCommand} from '@/types/index';
import {CustomCommandExecutor} from './executor';

const executor = new CustomCommandExecutor();

// Helper to create test command objects
function createTestCommand(overrides?: Partial<CustomCommand>): CustomCommand {
	return {
		name: 'test',
		fullName: 'test',
		namespace: '',
		path: '/test/command.md',
		content: 'Test content',
		metadata: {},
		...overrides,
	};
}

test('execute returns prompt with command content', t => {
	const command = createTestCommand({content: 'This is a test command'});

	const result = executor.execute(command, []);
	t.true(result.includes('This is a test command'));
	t.true(result.includes('/test'));
});

test('execute substitutes cwd variable', t => {
	const command = createTestCommand({content: 'Working in {{cwd}}'});

	const result = executor.execute(command, []);
	const expectedCwd = process.cwd();
	t.true(result.includes(expectedCwd));
});

test('execute substitutes command variable', t => {
	const command = createTestCommand({content: 'Running {{command}}'});

	const result = executor.execute(command, []);
	t.true(result.includes('/test'));
});

test('execute substitutes parameter variables', t => {
	const command = createTestCommand({
		content: 'Arg1: {{arg1}}, Arg2: {{arg2}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['value1', 'value2']);
	t.true(result.includes('value1'));
	t.true(result.includes('value2'));
});

test('execute handles missing parameters gracefully', t => {
	const command = createTestCommand({
		content: 'Arg1: {{arg1}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['value1']);
	// Should still work, missing arg2 becomes empty string
	t.true(result.includes('value1'));
});

test('execute includes args variable with all arguments', t => {
	const command = createTestCommand({
		content: 'All args: {{args}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['hello', 'world']);
	t.true(result.includes('hello world'));
});

test('execute adds note about custom command', t => {
	const command = createTestCommand();

	const result = executor.execute(command, []);
	t.true(result.includes('Executing custom command'));
	t.true(result.includes('enhance it'));
});

test('formatHelp returns command name', t => {
	const command = createTestCommand();

	const result = executor.formatHelp(command);
	t.true(result.includes('/test'));
});

test('formatHelp includes parameters', t => {
	const command = createTestCommand({
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('<arg1>'));
	t.true(result.includes('<arg2>'));
});

test('formatHelp includes description', t => {
	const command = createTestCommand({
		metadata: {
			description: 'This is a test command',
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('This is a test command'));
});

test('formatHelp includes aliases', t => {
	const command = createTestCommand({
		fullName: 'namespace:test',
		namespace: 'namespace',
		metadata: {
			aliases: ['t', 'testy'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('namespace:t'));
	t.true(result.includes('namespace:testy'));
});

test('formatHelp includes aliases without namespace', t => {
	const command = createTestCommand({
		metadata: {
			aliases: ['t', 'testy'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('t, testy'));
});

// ──────────────────────────────────────────────────────────────
// executeWithParams tests (new parameter-aware execution path)
// ──────────────────────────────────────────────────────────────

test('executeWithParams returns prompt with EXECUTION CONTEXT block', t => {
	const command = createTestCommand({
		content: 'Do something useful.',
		metadata: {parameters: ['file']},
	});

	const result = executor.executeWithParams(command, 'src/main.ts');
	t.true(result.prompt.includes('--- EXECUTION CONTEXT ---'));
	t.true(result.prompt.includes('Command: /test'));
	t.true(result.prompt.includes('Arguments received: 1'));
	t.true(result.prompt.includes('- file: src/main.ts'));
	t.true(result.prompt.includes('Do something useful.'));
	t.true(
		result.prompt.includes(
			'Execute this command with the provided arguments.',
		),
	);
	t.true(result.prompt.includes('--- END CONTEXT ---'));
});

test('executeWithParams maps only N args when more provided', t => {
	const command = createTestCommand({
		content: 'Process {{file}} only.',
		metadata: {parameters: ['file']},
	});

	const result = executor.executeWithParams(
		command,
		'src/main.ts extra words here',
	);

	// Only first arg mapped
	t.is(result.echoedArgs, 'test src/main.ts');
	t.is(result.resolvedParameters.length, 1);
	t.is(result.resolvedParameters[0].name, 'file');
	t.is(result.resolvedParameters[0].value, 'src/main.ts');
	// Prompt should not contain 'extra words here' as a param value
	t.false(result.prompt.includes('- extra:'));
});

test('executeWithParams echo shows correctly formatted args', t => {
	const command = createTestCommand({
		fullName: 'caveman',
		name: 'caveman',
		content: 'Compress code.',
		metadata: {parameters: ['file']},
	});

	const result = executor.executeWithParams(
		command,
		'"src/main.ts" extra',
	);

	t.is(result.echoedArgs, 'caveman src/main.ts');
	// Note: "extra" is NOT in echoedArgs because it exceeds param count
});

test('executeWithParams respects quoted arguments', t => {
	const command = createTestCommand({
		content: 'Process {{path}} and {{target}}.',
		metadata: {parameters: ['path', 'target']},
	});

	const result = executor.executeWithParams(
		command,
		'"my project/src" prod',
	);

	t.deepEqual(result.resolvedParameters, [
		{name: 'path', value: 'my project/src'},
		{name: 'target', value: 'prod'},
	]);
});

test('executeWithParams handles no parameters defined', t => {
	const command = createTestCommand({content: 'No params needed.'});

	const result = executor.executeWithParams(command, 'a b c');

	t.is(result.resolvedParameters.length, 0);
	t.is(result.echoedArgs, 'test');
	t.true(result.prompt.includes('Arguments received: 0'));
});

test('executeWithParams substitutes template variables in content', t => {
	const command = createTestCommand({
		content: 'File to analyze: {{file}}. CWD: {{cwd}}.',
		metadata: {parameters: ['file']},
	});

	const result = executor.executeWithParams(command, 'app.tsx');
	t.true(result.prompt.includes('File to analyze: app.tsx'));
	t.true(result.prompt.includes(`CWD: ${process.cwd()}`));
});

test('executeWithParams with object-style parameter definitions', t => {
	const command = createTestCommand({
		fullName: 'analyze',
		name: 'analyze',
		content: 'Analyze {{source}} against {{target}}.',
		metadata: {
			parameters: [
				{name: 'source', type: 'path' as const, description: 'Source file'},
				{name: 'target', required: true},
			],
		},
	});

	const result = executor.executeWithParams(
		command,
		'"my code.ts" benchmarks/',
	);

	t.deepEqual(result.resolvedParameters, [
		{name: 'source', value: 'my code.ts'},
		{name: 'target', value: 'benchmarks/'},
	]);
	t.is(result.echoedArgs, 'analyze my code.ts benchmarks/');
});

test('executeWithParams handles empty input gracefully', t => {
	const command = createTestCommand({
		content: 'No args mode.',
		metadata: {parameters: ['file']},
	});

	const result = executor.executeWithParams(command, '');
	t.is(result.resolvedParameters.length, 0);
	t.is(result.echoedArgs, 'test');
	t.true(result.prompt.includes('Arguments received: 0'));
});

test('executeWithParams includes resource info when available', t => {
	const command = createTestCommand({
		content: 'Work with resources.',
		metadata: {parameters: ['input']},
		loadedResources: [{name: 'helper.sh', path: '/tmp/helper.sh', type: 'script'}],
	});

	const result = executor.executeWithParams(command, 'data.txt');
	t.true(result.prompt.includes('[Available resources:'));
	t.true(result.prompt.includes('- helper.sh (script)'));
});

test('executeWithParams handles fewer tokens than required params', t => {
	const command = createTestCommand({
		content: '{{a}} and {{b}} and {{c}}',
		metadata: {parameters: ['a', 'b', 'c']},
	});

	const result = executor.executeWithParams(command, 'only-one');

	t.is(result.resolvedParameters.length, 1);
	t.is(result.resolvedParameters[0].name, 'a');
	t.is(result.resolvedParameters[0].value, 'only-one');
	// Template variables for b and c remain unsubstituted
	t.true(result.prompt.includes('{{b}}'));
	t.true(result.prompt.includes('{{c}}'));
});
