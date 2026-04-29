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
	t.true(result.includes('Arg1: value1, Arg2: value2'));
});

test('execute handles missing parameters gracefully', t => {
	const command = createTestCommand({
		content: 'Arg1: {{arg1}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['value1']);
	// Should still work; arg2 maps to empty string so template resolves to empty
	t.true(result.includes('Arg1: value1'));
});

test('execute includes args variable with all arguments', t => {
	const command = createTestCommand({
		content: 'All args: {{args}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['hello', 'world']);
	t.true(result.includes('All args: hello world'));
});

test('execute limits tokens to declared param count', t => {
	const command = createTestCommand({
		content: '{{file}} only',
		metadata: {parameters: ['file']},
	});

	// Pass 3 tokens but only 1 param is declared — extra tokens are ignored
	const result = executor.execute(command, ['src/main.ts', 'extra', 'words']);
	t.true(result.includes('src/main.ts only'));
	t.false(result.includes('extra'));
});

test('execute uses all tokens when no parameters declared', t => {
	const command = createTestCommand({content: 'Input: {{args}}'});

	const result = executor.execute(command, ['a', 'b', 'c']);
	t.true(result.includes('Input: a b c'));
});

test('execute substitutes template variables in content with object-style params', t => {
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

	const result = executor.execute(command, ['my-code.ts', 'benchmarks/']);
	t.true(result.includes('Analyze my-code.ts against benchmarks/.') );
});

test('execute leaves unsubstituted placeholders for missing args', t => {
	const command = createTestCommand({
		content: '{{a}} and {{b}} and {{c}}',
		metadata: {parameters: ['a', 'b', 'c']},
	});

	const result = executor.execute(command, ['only-one']);
	t.true(result.includes('only-one and {{b}} and {{c}}'));
});

test('execute includes resource info when available', t => {
	const command = createTestCommand({
		content: 'Work with resources.',
		metadata: {parameters: ['input']},
		loadedResources: [{name: 'helper.sh', path: '/tmp/helper.sh', type: 'script'}],
	});

	const result = executor.execute(command, ['data.txt']);
	t.true(result.includes('[Available resources:'));
	t.true(result.includes('- helper.sh (script)'));
});

// ──────────────────────────────────────────────────────────────
// formatHelp tests
// ──────────────────────────────────────────────────────────────

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
