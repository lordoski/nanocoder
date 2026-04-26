# Implementation Plan: Judge Feature for Acceptance Criteria Validation

## Phase 0: Architecture Analysis (Completed)

### Current State:
• Tasks stored as JSON with fields: `id`, `title`, `description`, `status`, `createdAt`, `updatedAt`, `completedAt`
• Configuration loaded from `agents.config.json` (project-level or global `~/.nanocoder/`)
• Provider system exists via `ai-sdk-client/factory.ts` with automatic fallback
• Tool execution uses Vercel AI SDK `tool()` pattern
• No built-in error recovery or post-validation hooks
• Conversation loop already has recursion mechanism for empty responses and errors

---

## Phase 1: Data Model Extensions

### 1.1 Task Schema Update (`source/tools/tasks/types.ts`)

```typescript
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;

    // NEW FIELD
    acceptanceCriteria?: string[];  // Array of testable conditions
}
```

**Migration Consideration:**
• Existing tasks without `acceptanceCriteria` should be treated as "no criteria defined"
• The Judge must handle missing criteria gracefully (skip validation for those tasks)

---

### 1.2 Configuration Schema (`source/config/index.ts`)

Add judge configuration to the existing settings interface:

```typescript
interface JudgeConfig {
    enabled: boolean;
    needsApproval: boolean;   // Follows same behavior as chat approval UI component
    provider: {
        name: string;       // Matches existing provider names (ollama, openrouter, etc.)
        model: string;      // e.g., "llama-cpp-tiny"
    };
    options?: {
        maxIterations: number;   // Max recursion depth (0 = infinite)
        timeoutMs?: number;      // Max execution time per task validation
    };
}
```

**Loading Location:**
• Add to existing config loader in `source/config/index.ts` alongside other settings
• Reuse `getClosestConfigFile('agents.config.json')` pattern (project → global fallback)
• Environment variable override support if available

**Config File Structure (`agents.config.json`):**

```json
{
  "judge": {
    "enabled": true,
    "needsApproval": true,
    "provider": {
      "name": "ollama",
      "model": "llama-cpp-tiny"
    },
    "options": {
      "maxIterations": 3,
      "timeoutMs": 60000
    }
  }
}
```

---

## Phase 2: New Tool — Judge (`source/tools/judge-tool.tsx`)

### 2.1 Tool Definition Structure

```typescript
import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/index';

interface JudgeInput {
    mode: 'full' | 'task';       // Full run vs single task
    taskId?: string;             // Required when mode is 'task'
}

const judgeCoreTool = tool({
    name: 'judge',
    description: 'Validate all completed tasks against their acceptance criteria. Uses the configured LLM provider to evaluate each criterion by reading files and running commands as specified.',
    inputSchema: jsonSchema<JudgeInput>({
        type: 'object',
        properties: {
            mode: {type: 'string', enum: ['full', 'task']},
            taskId: {type: 'string'},
        },
        required: ['mode'],
    }),
    needsApproval: true,  // Follows same behavior as chat approval UI component
});
```

### 2.2 Judge Execution Logic

**Step-by-step flow:**

#### Step 1: Load Configuration
```typescript
async function loadJudgeConfig(): Promise<JudgeConfig | null> {
    try {
        const settings = await readAgentsConfig();  // Reuse existing config loader
        
        if (!settings?.judge?.enabled) return null;
        
        // Validate provider exists in available providers
        const providerName = settings.judge.provider.name;
        const providers = getAvailableProviders(settings);  // From client-factory
        
        if (!providers.includes(providerName)) {
            console.warn(`Judge provider '${providerName}' not found, falling back to primary`);
            // Will use primary provider later
        }
        
        return {
            enabled: true,
            needsApproval: settings.judge.needsApproval ?? true,  // Defaults to true
            provider: settings.judge.provider,
            options: settings.judge.options || {maxIterations: 3, timeoutMs: 60000}
        };
    } catch (error) {
        console.warn('Judge config failed to load:', error.message);
        return null;
    }
}
```

#### Step 2: Fetch All Tasks
```typescript
const tasks = await loadTasks();
const completedTasks = tasks.filter(t => t.status === 'completed');
```

#### Step 3: Iterate and Validate Each Task (Sequential)
For each completed task with `acceptanceCriteria`:
• Build a validation prompt for the LLM
• Execute via configured provider (with fallback to primary)
• Collect pass/fail results

**Note:** Validation is **sequential** — one task at a time. This prevents overwhelming lighter models that may struggle with parallel API calls.

#### Step 4: Build Validation Prompt Template

**Prompt for file/command-based validation:**

```
You are a quality assurance judge. Evaluate whether this task meets its acceptance criteria by actually verifying the codebase state through commands and file reads.

TASK: {title}
DESCRIPTION: {description}
ACCEPTANCE CRITERIA: {criteria_list}

FOR EACH CRITERION:
1. Identify what needs to be verified (file existence, content pattern, command output, etc.)
2. Run the appropriate verification command(s):
   - Use `cat <path>` to check file contents
   - Use `ls` or `find` to verify files/directories exist
   - Use `grep` to search for patterns in files
   - Run relevant test/build commands if mentioned in criteria
3. Compare actual results against expected outcomes
4. Record pass/fail status with explanation

RESPOND ONLY IN THIS JSON FORMAT:
{
  "task_id": "...",
  "task_title": "...",
  "results": [
    {"criterion": "...", "passed": true/false, "reason": "..."}
  ],
  "allPassed": true/false
}
```

#### Step 5: Aggregate Results

```typescript
interface JudgeResult {
    taskId: string;
    taskTitle: string;
    criteriaResults: Array<{
        criterion: string;
        passed: boolean;
        reason?: string;
    }>;
    allPassed: boolean;
    failedCriteria: string[];
}

const allResults: JudgeResult[] = [];

for (const task of completedTasks) {
    if (!task.acceptanceCriteria?.length) continue;
    
    const result = await validateSingleTask(task, client);
    allResults.push(result);
}
```

#### Step 6: Format Output

**If ALL tasks pass:**
```
<result>APPROVED</result>
```

**If ANY task fails (only failed criteria shown):**
```
## JUDGE REPORT - VALIDATION FAILED

### Failed Tasks Summary

---

**Task: [title]**
- Description: [description]
- Failed Criteria:
  1. [criterion_1]: [reason]
  2. [criterion_2]: [reason]

---

**Task: [another_failed_task]**
...

---

To reproduce failures, review the above criteria and verify each against the codebase.
Run relevant commands mentioned in acceptance criteria to confirm state.
```

#### Step 7: Single Task Validation Implementation

```typescript
async function validateSingleTask(
    task: Task,
    llmClient: LLMClient,
    options?: {timeoutMs?: number}
): Promise<JudgeResult> {
    // Build prompt with criterion-by-criterion evaluation
    const prompt = buildValidationPrompt(task);
    
    // Execute completion via configured provider
    const response = await llmClient.chat({
        messages: [{role: 'user', content: prompt}],
        model: llmClient.getModel(),
    });
    
    // Parse JSON response (with fallback handling)
    const parsed = parseJudgeResponse(response.content);
    
    return {
        taskId: task.id,
        taskTitle: task.title,
        criteriaResults: parsed.results,
        allPassed: parsed.allPassed,
        failedCriteria: parsed.results
            .filter(r => !r.passed)
            .map(r => r.criterion),
    };
}
```

---

## Phase 3: Conversation Loop Integration

### 3.1 Post-Task Completion Checkpoint

**Location:** `source/hooks/chat-handler/conversation/conversation-loop.tsx` — where conversation decides to end after all tasks are completed.

**New Logic Flow:**

1. Agent calls `list_tasks` → sees all completed ✓
2. **BEFORE ending conversation:**
   a. Call judge tool automatically
   b. Check if result contains `<result>APPROVED</result>`

3. **If APPROVED:**
   → Proceed with normal conversation end

4. **If NOT approved:**
   → Extract failure details from output
   → Format "CONTINUE" message with failures
   → Recurse using the same pattern as empty response handling

### 3.2 Recursive Continue Mechanism (Following existing patterns)

**Based on how empty responses are handled in `conversation-loop.tsx`:**

```typescript
async function handleJudgeResult(
    result: string,
    setMessages: SetFunction<Message[]>,
    sendMessageToAgent: Function
): Promise<boolean> {
    // Check for approval signal
    if (result.includes('<result>APPROVED</result>')) {
        return true;  // Can proceed to end
    }
    
    // Not approved - prepare continuation
    const continuePrompt = buildContinuePrompt(result);
    
    // NO task re-queueing needed — the CONTINUE message will cause
    // the agent to clear failed tasks via list_tasks + update mechanism
    
    // Add error context messages (same pattern as empty response handling)
    // Users see intermediate validation steps via this flow
    const errorBuilder = new ConversationMessageBuilder();
    errorBuilder.addUserMessage(continuePrompt);
    const updatedMessages = errorBuilder.build();
    setMessages(updatedMessages);
    
    // Signal agent to fix issues (recursive call)
    await processAssistantResponse({
        ...params,
        messages: updatedMessages,
        conversationStartTime: startTime,
    });
    
    return false;  // Must recurse
}
```

### 3.3 Recursion Depth Control

Using `maxIterations` from config (0 = infinite):

```typescript
let iterationCount = 0;
const maxIterations = judgeConfig?.options?.maxIterations ?? 0;

async function runWithIterationLimit(): Promise<boolean> {
    while (true) {
        if (maxIterations > 0 && iterationCount >= maxIterations) {
            console.warn(`Judge recursion limit reached (${maxIterations})`);
            return true;  // Force end after max iterations
        }
        
        const approved = await handleJudgeResult(result, setMessages, sendMessageToAgent);
        if (approved) return true;
        
        iterationCount++;
    }
}
```

---

## Phase 4: Task Creation Enhancement

### 4.1 Extended Task Schema in Create Tool

Update `source/tools/tasks/create-task.tsx`:

```typescript
interface TaskInput {
    title: string;
    description?: string;
    acceptanceCriteria?: string[];  // NEW
}
```

**Update JSON schema:**
```json
{
  "properties": {
    "acceptanceCriteria": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Clear, testable conditions for task completion"
    }
  }
}
```

### 4.2 LLM Prompt Enhancement for Task Creation

Add system prompt instruction when creating tasks:

```
IMPORTANT: Always include acceptance criteria for each task you create.
Acceptance criteria should be:
1. Specific and measurable (not vague statements)
2. Reproducible via commands or observable state changes
3. Written as "Verify that..." or "Ensure..." format

PREFERRED FORMAT:
- Run command X to verify Y exists
- Check file Z contains pattern A
- Confirm output matches expected result B

EXAMPLE GOOD CRITERIA:
✓ "Run `ls dist/` to confirm build artifacts exist"
✓ "Execute `cat config.json | grep 'version'` to verify config is loaded"
✓ "All existing tests pass (pnpm test:all completes successfully)"
✗ "Make sure the feature works properly" (too vague)
✗ "Test that it's correct" (untestable)
```

---

## Phase 5: Configuration Loading

### 5.1 Config File Structure (`agents.config.json`)

Already defined in Phase 1.2 above. Reuses existing nanocoder settings JSON format.

**Loading Locations:**
1. **Project root**: `{cwd}/agents.config.json`
2. **Global directory**: `~/.nanocoder/agents.config.json`

Uses existing `getClosestConfigFile('agents.config.json')` function from `source/config/index.ts`.

### 5.2 Config Loader Function

Location: Add to `source/config/index.ts` alongside existing config functions.

```typescript
export async function loadJudgeConfig(): Promise<JudgeConfig | null> {
    try {
        const settings = await readAgentsConfig();
        
        if (!settings?.judge?.enabled) return null;
        
        // Validate provider exists in available providers
        const providerName = settings.judge.provider.name;
        const providers = getAvailableProviders(settings);
        
        if (!providers.includes(providerName)) {
            console.warn(`Judge provider '${providerName}' not found, will use primary`);
        }
        
        return {
            enabled: true,
            needsApproval: settings.judge.needsApproval ?? true,  // Defaults to true
            provider: settings.judge.provider,
            options: settings.judge.options || {maxIterations: 3, timeoutMs: 60000}
        };
    } catch (error) {
        console.warn('Judge config failed to load:', error.message);
        return null;
    }
}
```

---

## Phase 6: Tool Registration

Register the new judge tool alongside existing tools:

**Location:** `source/tools/index.ts` — add to both static and conditional tool lists based on availability.

```typescript
import {judgeTool} from './judge-tool';

// Add to static tools (always available like other core tools)
const staticTools: NanocoderToolExport[] = [
    readFileTool,
    writeFileTool,
    stringReplaceTool,
    executeBashTool,
    webSearchTool,
    fetchUrlTool,
    findFilesTool,
    searchFileContentsTool,
    getDiagnosticsTool,
    listDirectoryTool,
    agentTool,
    // Interaction tools
    askQuestionTool,
    // File operation tools
    ...getFileOpTools(),
    // Task management tools
    createTaskTool,
    listTasksTool,
    updateTaskTool,
    deleteTaskTool,
    // Judge tool - always available
    judgeTool as NanocoderToolExport,
];
```

---

## Phase 7: Testing Strategy

### 7.1 Unit Tests (`source/tools/judge-tool.spec.tsx`)

| Test Case | Description |
|-----------|-------------|
| `judge_not_enabled` | Returns early message when judge disabled |
| `all_criteria_pass` | Returns APPROVED |
| `some_criteria_fail` | Returns detailed failure report |
| `no_acceptance_criteria` | Skips tasks without criteria |
| `provider_initialization_fallback` | Falls back to primary if configured unavailable |
| `json_parse_fallback` | Handles malformed LLM responses |
| `max_iterations_exceeded` | Stops recursion after N attempts |
| `single_task_mode` | Validates only specified task |
| `approval_ui_consistent` | Follows same behavior as chat approval UI component |
| `sequential_validation_order` | Validates tasks one at a time |

### 7.2 Integration Tests

1. Create tasks with acceptance criteria → mark complete → run judge
2. Simulate failed criteria → verify continue/recurse behavior
3. End-to-end: task creation → completion → judge approval flow
4. Test approval UI consistency (same behavior as chat component)
5. Test sequential validation under load (light model simulation)
6. Test error reporting visibility (system message + inline notification)

---

## Phase 8: Edge Cases & Error Handling

| Scenario | Handler |
|----------|---------|
| Judge provider unavailable | Report error and continue conversation end (do NOT silently fall back) |
| LLM response timeout | Retry with exponential backoff (respect maxIterations) |
| Malformed JSON from judge | Parse best-effort, log warning, treat as fail-safe |
| Task file corruption | Skip corrupted tasks, log error, continue |
| Infinite recursion protection | Hard cap at configurable max iterations (0 = unlimited) |
| Large codebase slowdown | No caching — accept I/O overhead; add timeout per-task validation |
| Empty completed tasks list | Return early with success message |
| Provider completely down | Report error to user, allow conversation to end normally |

---

## Implementation Order (Recommended)

1. **Phase 1** — Data model extensions (Task schema + config types)
2. **Phase 5** — Configuration loader (reuse existing patterns)
3. **Phase 4** — Task creation enhancement (encourage acceptance criteria)
4. **Phase 2** — Judge tool implementation
5. **Phase 6** — Tool registration
6. **Phase 3** — Conversation loop integration
7. **Phase 7** — Testing
8. **Phase 8** — Edge case hardening
