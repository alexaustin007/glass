const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

function stream(text) {
    const data = JSON.stringify({ choices: [{ delta: { content: text } }] });
    const bytes = new TextEncoder().encode('data: ' + data + '\r\n\r\ndata: [DONE]\n\n');
    return { body: new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
        controller.close();
    } }) };
}

async function fixture(t, responder = ({ question }) => stream('Answer to ' + question + ' Ó')) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-interview-'));
    await fs.writeFile(path.join(dir, 'interview-context.md'), 'At Northstar I delivered the verified warehouse scheduling project.');
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const calls = [];
    const events = [];
    const model = { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'test' };
    const dependencies = {
        electron: { app: { getPath: () => dir } },
        '../src/features/common/services/modelStateService': { getCurrentModelInfo: async () => model },
        '../src/features/common/ai/factory': {
            createStreamingLLM: (_provider, options) => ({ streamChat(messages) {
                const call = { ...JSON.parse(messages[1].content), instructions: messages[0].content, options };
                calls.push(call);
                return responder(call);
            } }),
        },
    };
    for (const [name, exports] of Object.entries(dependencies)) {
        const id = require.resolve(name);
        const previous = require.cache[id];
        require.cache[id] = { id, loaded: true, exports };
        t.after(() => { if (previous) require.cache[id] = previous; else delete require.cache[id]; });
    }
    const id = require.resolve('../src/features/ask/interviewService');
    delete require.cache[id];
    const service = require(id);
    t.after(() => { service.pause(); delete require.cache[id]; });
    service.notify = (name, value) => events.push({ name, value });
    return { service, calls, events, model };
}

async function until(check) {
    for (let i = 0; i < 100; i++) {
        if (check()) return;
        await wait(10);
    }
    assert.ok(check(), 'Timed out waiting for an interview event');
}

const latest = service => [...service.turns.values()].at(-1);
const contextText = call => call.recentConversation.map(entry => entry.text).join('\n');

function finish(service, speaker, text) {
    service.transcript(speaker, text);
    service.finishSpeech();
}

test('both inputs start together: solo mic asks, caller leads, real mic replies and corrections stay ordered', async t => {
    const { service, calls, events } = await fixture(t);
    service.start();
    service.interim('How would you design the table?', 'Me');
    assert.equal(calls.length, 0);
    service.transcript('Me', 'How would you design the table?');
    await until(() => latest(service)?.status === 'done');
    const solo = latest(service);
    assert.equal(solo.source, 'mic');
    assert.deepEqual(solo.speechIds, [service.getSpeech()[0].id]);
    assert.equal(solo.answer, 'Answer to How would you design the table? Ó');
    assert.equal(events.filter(event => event.name === 'ask:interviewSpeech').length, 1);
    service.transcript('Them', solo.question); // same audio through mic and loopback
    finish(service, 'Them', 'What delay should the system allow?');
    await until(() => latest(service).status === 'done');
    service.transcript('Me', 'I would allow exactly thirty-seven minutes.');
    service.transcript('Me', 'Actually, can we use fifteen minutes instead?');
    service.transcript('Them', 'That makes sense.');
    finish(service, 'Them', 'What was the limit after that correction?');
    await until(() => latest(service).status === 'done');
    assert.equal(calls.length, 3);
    const recent = calls.at(-1).recentConversation;
    const spoken = recent.filter(entry => entry.source === 'Microphone').map(entry => entry.text);
    assert.deepEqual(spoken.slice(-2), ['I would allow exactly thirty-seven minutes.', 'Actually, can we use fifteen minutes instead?']);
    assert.deepEqual(recent.slice(-2).map(entry => entry.source), ['Microphone', 'Caller']);
    assert.match(calls.at(-1).instructions, /latest actual correction/i);
    finish(service, 'Me', 'Glass, explain this in one sentence.');
    await until(() => latest(service).status === 'done');
    assert.equal(latest(service).source, 'mic');
    assert.equal(latest(service).question, 'explain this in one sentence.');
    service.lastCallerTime = Date.now() - 100000;
    finish(service, 'Me', 'Why is the sky blue?');
    assert.equal(latest(service).source, 'mic');
    assert.equal(latest(service).parentId, undefined);
});

test('one multipart turn survives pauses and interim revisions; statements remain captions only', async t => {
    const { service, calls } = await fixture(t);
    service.start();
    for (const text of ['Okay?', 'Thanks.', 'When I see a duplicate, I keep the new version.', 'What I did was change the key.', 'We receive hourly batches.']) {
        finish(service, 'Them', text);
    }
    assert.equal(service.turns.size, 0);
    assert.equal(service.getSpeech().length, 5);
    service.interim('How would you handle invoicing?');
    service.interim('How would you handle duplicates?');
    service.transcript('Them', 'What changes if a correction arrives with that same');
    await wait(160);
    service.interim('identifier but a newer');
    assert.equal(calls.length, 0);
    service.transcript('Them', 'identifier but a newer version? And how would you test it?');
    await until(() => latest(service)?.status === 'done');
    assert.equal(calls.length, 1);
    assert.equal(latest(service).question, 'What changes if a correction arrives with that same identifier but a newer version? And how would you test it?');
    assert.equal(latest(service).speechIds.length, 2);
    assert.doesNotMatch(JSON.stringify(calls), /invoicing/);
    assert.match(contextText(calls[0]), /hourly batches/);
    finish(service, 'Them', 'Who did you speak to?');
    assert.equal(latest(service).question, 'Who did you speak to?');
    service.transcript('Them', 'Could you');
    service.endListening();
    assert.equal(service.turns.size, 2);
});

test('typed questions work before starting and while paused, scoped profile and latest code are supplied', async t => {
    const code = '```python\ndef tally(items):\n    return len(set(items))\n```';
    const { service, calls, events } = await fixture(t, call => stream(call.question.startsWith('Write') ? code : 'Fixture response.'));
    service.ask('At Northstar specifically, who used the warehouse scheduling app?');
    await until(() => latest(service).status === 'done');
    assert.equal(latest(service).source, 'typed');
    assert.match(calls[0].instructions, /verified warehouse scheduling project/);
    service.resume();
    service.transcript('Them', 'For this exercise, invoices arrive twice with the same identifier.');
    service.transcript('Them', 'Write a Python function that counts incoming identifiers once.');
    service.finishSpeech();
    await until(() => latest(service).status === 'done');
    assert.equal(latest(service).parentId, undefined);
    assert.doesNotMatch(contextText(calls[1]), /Northstar|Fixture response/);
    assert.doesNotMatch(calls[1].instructions, /verified warehouse scheduling project/);
    assert.match(calls[1].instructions, /Markdown code fence with the language tag/);
    assert.match(calls[1].instructions, /time and space complexity/);
    assert.ok(calls[1].options.maxTokens >= 1600);
    service.pause();
    const q = service.ask('Write a Python implementation for tally.');
    await until(() => latest(service).status === 'done');
    service.ask('Show me the code in JavaScript.');
    await until(() => latest(service).status === 'done');
    assert.equal(latest(service).parentId, q.id);
    assert.ok(calls.at(-1).recentConversation.some(entry => entry.source === 'Glass suggestion (unspoken)' && entry.text === code));
    service.resume();
    assert.equal(service.turns.size, 4);
    assert.equal(events.filter(event => event.name === 'ask:interviewReset').length, 0);
    assert.doesNotMatch(JSON.stringify(events), /verified warehouse scheduling project/);
});

test('related questions wait for the exact prior answer, independent topics run concurrently', async t => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const { service, calls } = await fixture(t, call => call.question === 'Implement binary search.' ? response : stream('Independent answer.'));
    const parent = service.ask('Implement binary search.');
    const child = service.ask('Give a concrete example of that.');
    const separate = service.ask('Why is the sky blue?');
    await until(() => service.turns.get(separate.id).status === 'done');
    assert.equal(service.turns.get(child.id).status, 'queued');
    assert.deepEqual(calls.map(call => call.question), ['Implement binary search.', 'Why is the sky blue?']);
    assert.equal(calls[1].recentConversation.length, 0);
    release(stream('```python\ndef bisect_index(xs, target): pass\n```'));
    await until(() => service.turns.get(child.id).status === 'done');
    assert.equal(service.turns.get(child.id).parentId, parent.id);
    assert.match(contextText(calls.at(-1)), /bisect_index/);
    assert.doesNotMatch(contextText(calls.at(-1)), /sky blue/);
    service.followup(parent.id, 'example');
    await until(() => latest(service).status === 'done');
    assert.match(contextText(calls.at(-1)), /bisect_index/);
    assert.doesNotMatch(contextText(calls.at(-1)), /sky blue/);
});

test('spoken facts can be recalled after switching subjects without treating suggestions as spoken', async t => {
    const { service, calls } = await fixture(t);
    service.start();
    finish(service, 'Them', 'Assume we need six retries.');
    finish(service, 'Them', 'How many retries do we need?');
    service.transcript('Me', 'Correction, four retries.');
    finish(service, 'Them', 'Why is the sky blue?');
    finish(service, 'Them', 'How many retries did I specify earlier?');
    await until(() => latest(service).status === 'done');
    const spoken = calls.at(-1).recentConversation.filter(entry => ['Microphone', 'Caller'].includes(entry.source));
    assert.ok(spoken.findIndex(entry => entry.text.includes('six retries')) < spoken.findIndex(entry => entry.text.includes('four retries')));
    assert.ok(spoken.some(entry => entry.source === 'Microphone' && entry.text.includes('four retries')));
});

test('rate limits fall back once for Gemini Flash and error cards can be retried', async t => {
    let fail = true;
    const { service, calls } = await fixture(t, call => {
        if (fail || call.options.model === 'gemini-2.5-flash') throw Object.assign(new Error('quota'), { status: 429 });
        return stream('Recovered.');
    });
    service.start();
    finish(service, 'Me', 'What is an index?');
    await until(() => latest(service).status === 'error');
    assert.deepEqual(calls.map(call => call.options.model), ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.match(latest(service).error, /usage limit/);
    fail = false;
    service.answer(latest(service).id);
    await until(() => latest(service).status === 'done');
    assert.equal(calls.at(-1).options.model, 'gemini-2.5-flash-lite');
    assert.equal(latest(service).answer, 'Recovered.');
});

test('pause discards incomplete speech, aborts pending answers, and rejects late packets', async t => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const { service, calls } = await fixture(t, () => response);
    service.start();
    finish(service, 'Them', 'How do indexes work?');
    await until(() => calls.length > 0);
    service.transcript('Them', 'Can you design a');
    service.pause();
    assert.ok(calls[0].options.signal.aborted);
    const stopped = latest(service);
    release(stream('Obsolete.'));
    finish(service, 'Them', 'question from an old socket?');
    await wait(10);
    assert.equal(stopped.answer, '');
    assert.equal(stopped.status, 'suggested');
    service.resume();
    assert.equal(service.turns.size, 1);
    service.start('caller');
    finish(service, 'Me', 'Private dictation.');
    assert.deepEqual(service.getSpeech(), []);
    assert.equal(service.setRepliesEnabled(true).success, true);
    finish(service, 'Me', 'Candidate reply.');
    assert.equal(service.getSpeech().length, 1);
    assert.equal(service.turns.size, 0);
    service.endListening();
    assert.equal(service.setRepliesEnabled(true).success, false);
});

test('a stable partial stays hidden, and an exact final publishes the same stream exactly once', async t => {
    const { service, calls, events } = await fixture(t);
    service.start();
    const question = 'Why do databases use indexes?';
    service.interim(question, 'Me');
    await until(() => calls.length === 1 && service.jobs.size === 0);
    assert.equal(service.turns.size, 0);
    assert.deepEqual(service.getSpeech(), []);
    assert.ok(!events.some(event => event.name === 'ask:interviewTurn'));
    service.transcript('Me', question);
    await until(() => latest(service)?.status === 'done');
    assert.equal(calls.length, 1);
    assert.equal(latest(service).answer, 'Answer to ' + question + ' Ó');
    assert.equal(latest(service).timestamp, service.getSpeech()[0].timestamp);
    assert.deepEqual(latest(service).speechIds, [service.getSpeech()[0].id]);
    assert.equal(events.filter(event => event.name === 'ask:interviewTurn').length, 1);
});

test('text revisions, source changes and intervening corrections invalidate speculative answers', async t => {
    const { service, calls, events } = await fixture(t);
    service.start();
    service.interim('Can you implement a class in C++?', 'Them');
    await until(() => calls.length === 1 && service.jobs.size === 0);
    service.interim('Can you implement a class in C#?', 'Them');
    finish(service, 'Them', 'Can you implement a class in C#?');
    await until(() => latest(service)?.status === 'done');
    assert.equal(calls.length, 2);
    assert.equal(latest(service).question, 'Can you implement a class in C#?');
    assert.doesNotMatch(JSON.stringify(events), /C\+\+/);
    const question = 'What was the setup constraint?';
    service.interim(question, 'Them');
    await until(() => calls.length === 3 && service.jobs.size === 0);
    service.transcript('Me', 'Correction: use local storage.');
    finish(service, 'Them', question);
    await until(() => latest(service)?.status === 'done');
    assert.equal(calls.length, 4);
    assert.match(contextText(calls[3]), /use local storage/);
    assert.doesNotMatch(contextText(calls[2]), /use local storage/);
    service.start();
    service.interim(question, 'Me');
    await until(() => calls.length === 5 && service.jobs.size === 0);
    finish(service, 'Them', question);
    await until(() => latest(service)?.status === 'done');
    assert.equal(calls.length, 6);
    assert.equal(latest(service).source, 'caller');
});

test('interruptions abort speculative requests; reset clears all account-scoped conversation state', async t => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const { service, calls, events } = await fixture(t, () => response);
    service.start();
    service.interim('How do you optimize this query?', 'Me');
    await until(() => calls.length === 1);
    service.interim('How do you optimize this query for skew?', 'Me');
    assert.ok(calls[0].options.signal.aborted);
    service.transcript('Me', 'How do you optimize this query for skew?');
    service.reset();
    release(stream('Stale answer.'));
    await wait(20);
    assert.equal(service.listening, false);
    assert.equal(service.context, null);
    assert.deepEqual(service.getSpeech(), []);
    assert.equal(service.turns.size, 0);
    assert.equal(events.at(-1).name, 'ask:interviewReset');
    assert.ok(!events.some(event => event.name === 'ask:interviewTurn'));
});

test('interrupted speakers retain their first partial timestamp even when their finals arrive out of order', async t => {
    const { service } = await fixture(t);
    service.start();
    service.interim('I worked on a', 'Me');
    await wait(5);
    service.interim('Who used it?', 'Them');
    finish(service, 'Them', 'Who used it?');
    service.transcript('Me', 'I worked on a scheduling project.');
    const speech = service.getSpeech();
    assert.ok(speech.find(entry => entry.source === 'mic').timestamp < speech.find(entry => entry.source === 'caller').timestamp);
});

test('caller questions survive loopback echoes when the microphone final arrives first', async t => {
    const { service, calls } = await fixture(t);
    service.start();
    const text = 'How do database transactions work?';
    service.interim('How do database', 'Them');
    service.transcript('Me', text);
    service.transcript('Them', text);
    await until(() => latest(service)?.status === 'done');
    assert.deepEqual(service.getSpeech().map(entry => entry.source), ['caller']);
    assert.equal(latest(service).source, 'caller');
    assert.equal(calls.length, 1);
});
