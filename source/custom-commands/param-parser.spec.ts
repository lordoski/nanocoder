import test from 'ava';
import {parseArgs} from './param-parser';

test('parses empty input', t => {
	const result = parseArgs('');
	t.deepEqual(result.allTokens, []);
});

test('parses single unquoted argument', t => {
	const result = parseArgs('arg1');
	t.deepEqual(result.allTokens, ['arg1']);
});

test('parses multiple unquoted arguments', t => {
	const result = parseArgs('a b c');
	t.deepEqual(result.allTokens, ['a', 'b', 'c']);
});

test('respects double quotes', t => {
	const result = parseArgs('"arg with spaces"');
	t.deepEqual(result.allTokens, ['arg with spaces']);
});

test('respects single quotes', t => {
	const result = parseArgs("'arg with spaces'");
	t.deepEqual(result.allTokens, ['arg with spaces']);
});

test('mixes quoted and unquoted tokens', t => {
	const result = parseArgs('"a b" c');
	t.deepEqual(result.allTokens, ['a b', 'c']);
});

test('handles mixed quote styles in one input', t => {
	const result = parseArgs('"a" b \'c d\' e');
	t.deepEqual(result.allTokens, ['a', 'b', 'c d', 'e']);
});

test('ignores extra whitespace between tokens', t => {
	const result = parseArgs('   a    b  ');
	t.deepEqual(result.allTokens, ['a', 'b']);
});

test('leniently handles unclosed double quote', t => {
	const result = parseArgs('"unclosed');
	t.deepEqual(result.allTokens, ['unclosed']);
});

test('leniently handles unclosed single quote', t => {
	const result = parseArgs("'unclosed");
	t.deepEqual(result.allTokens, ['unclosed']);
});

test('inner quotes become part of token value', t => {
	const result = parseArgs('"it\'s here"');
	t.deepEqual(result.allTokens, ["it's here"]);
});

test('returns empty array for all-whitespace input', t => {
	const result = parseArgs('   ');
	t.deepEqual(result.allTokens, []);
});
