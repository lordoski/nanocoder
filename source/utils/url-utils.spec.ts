import test from 'ava';
import {isLocalURL} from './url-utils';

// ============================================================================
// isLocalURL - localhost
// ============================================================================

test('isLocalURL returns true for http://localhost', t => {
	t.true(isLocalURL('http://localhost'));
});

test('isLocalURL returns true for http://localhost:11434/v1', t => {
	t.true(isLocalURL('http://localhost:11434/v1'));
});

test('isLocalURL returns true for https://localhost:8080', t => {
	t.true(isLocalURL('https://localhost:8080'));
});

// ============================================================================
// isLocalURL - 127.0.0.1
// ============================================================================

test('isLocalURL returns true for http://127.0.0.1', t => {
	t.true(isLocalURL('http://127.0.0.1'));
});

test('isLocalURL returns true for http://127.0.0.1:11434/v1', t => {
	t.true(isLocalURL('http://127.0.0.1:11434/v1'));
});

test('isLocalURL returns true for https://127.0.0.1:8080/api', t => {
	t.true(isLocalURL('https://127.0.0.1:8080/api'));
});

// ============================================================================
// isLocalURL - 0.0.0.0
// ============================================================================

test('isLocalURL returns true for http://0.0.0.0:11434', t => {
	t.true(isLocalURL('http://0.0.0.0:11434'));
});

// ============================================================================
// isLocalURL - ::1 (IPv6 loopback)
// ============================================================================

test('isLocalURL returns true for http://[::1]:11434/v1', t => {
	t.true(isLocalURL('http://[::1]:11434/v1'));
});

// ============================================================================
// isLocalURL - remote URLs
// ============================================================================

test('isLocalURL returns false for https://api.openai.com/v1', t => {
	t.false(isLocalURL('https://api.openai.com/v1'));
});

test('isLocalURL returns false for https://openrouter.ai/api/v1', t => {
	t.false(isLocalURL('https://openrouter.ai/api/v1'));
});

test('isLocalURL returns false for https://example.com', t => {
	t.false(isLocalURL('https://example.com'));
});

// ============================================================================
// isLocalURL - malformed URLs (fallback to string matching)
// ============================================================================

test('isLocalURL handles malformed URL with localhost', t => {
	t.true(isLocalURL('localhost:11434'));
});

test('isLocalURL handles malformed URL with 127.0.0.1', t => {
	t.true(isLocalURL('127.0.0.1:11434'));
});

test('isLocalURL returns false for malformed non-local URL', t => {
	t.false(isLocalURL('not-a-url'));
});

// ============================================================================
// isLocalURL - private IP ranges (LAN)
// ============================================================================

test('isLocalURL returns true for 192.168.x.x LAN addresses', t => {
	t.true(isLocalURL('http://192.168.1.7:4000/v1/chat/completions'));
	t.true(isLocalURL('http://192.168.0.1:8080'));
	t.true(isLocalURL('http://192.168.255.255'));
});

test('isLocalURL returns true for 10.x.x.x private addresses', t => {
	t.true(isLocalURL('http://10.0.0.1:3000'));
	t.true(isLocalURL('http://10.255.255.255'));
});

test('isLocalURL returns true for 172.16-31.x.x private addresses', t => {
	t.true(isLocalURL('http://172.16.0.1:8080'));
	t.true(isLocalURL('http://172.31.255.255'));
});

test('isLocalURL returns false for 172.x outside the 16-31 range', t => {
	t.false(isLocalURL('http://172.15.0.1:8080'));
	t.false(isLocalURL('http://172.32.0.1:8080'));
});

test('isLocalURL returns true for 169.254.x.x link-local addresses', t => {
	t.true(isLocalURL('http://169.254.1.1:8080'));
});

test('isLocalURL handles malformed URL with 192.168.x fallback', t => {
	t.true(isLocalURL('192.168.1.7:4000'));
});
