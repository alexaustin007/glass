const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

test('promotes only matching interim questions and streams separate grounded answers', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-interview-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, 'interview-context.md'), 'Worked on a verified toy system.');

    const prompts = [];
    const updates = [];
    const models = [];
    let rateLimitFlash = false;
    const dependencies = {
        electron: { app: { getPath: () => dir } },
        '../src/features/common/services/modelStateService': {
            getCurrentModelInfo: async () => ({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'test' }),
        },
        '../src/features/common/ai/factory': {
            createStreamingLLM: (_provider, options) => ({
                async streamChat(messages) {
                    models.push(options.model);
                    if (rateLimitFlash && options.model === 'gemini-2.5-flash') {
                        throw Object.assign(new Error('Model quota reached'), { status: 429 });
                    }
                    prompts.push(messages);
                    const { question } = JSON.parse(messages[1].content);
                    const content = 'Answer ' + question + ' Ó';
                    const data = JSON.stringify({ choices: [{ delta: { content } }] });
                    const bytes = new TextEncoder().encode('data: ' + data + '\r\n\r\ndata: [DONE]\n\n');
                    const body = new ReadableStream({
                        start(controller) {
                            for (let offset = 0; offset < bytes.length; offset += 3) {
                                controller.enqueue(bytes.slice(offset, offset + 3));
                            }
                            controller.close();
                        },
                    });
                    return { body };
                },
            }),
        },
    };
    for (const [name, exports] of Object.entries(dependencies)) {
        const id = require.resolve(name);
        const previous = require.cache[id];
        require.cache[id] = { id, loaded: true, exports };
        t.after(() => { if (previous) require.cache[id] = previous; else delete require.cache[id]; });
    }

    const service = require('../src/features/ask/interviewService');
    t.after(() => service.pause());
    service.notify = (name, turn) => { if (turn) updates.push({ ...turn }); };
    service.start();
    service.transcript('Me', 'Private dictation');
    assert.doesNotMatch(service.recentConversation(), /Private dictation/);
    assert.equal(service.setRepliesEnabled(true).success, true);
    service.transcript('Me', 'Opted in example');
    assert.match(service.recentConversation(), /Opted in example/);
    const original = 'What would you do with Atlas?';
    service.interim(original.slice(0, -1));
    await wait(275);
    assert.equal(prompts.length, 0);
    service.interim(original);
    await wait(150);
    assert.equal(prompts.length, 1);
    assert.equal(updates.length, 0);
    service.transcript('Them', original);
    await wait(20);
    assert.equal(prompts.length, 1);
    assert.equal(updates.at(-1).answer, 'Answer ' + original + ' Ó');
    assert.match(prompts[0][0].content, /verified toy system/);

    service.lastPrefetchTime = 0;
    service.interim('How did you implement retries?');
    await wait(150);
    service.interim('How did you implement reviews?');
    service.transcript('Them', 'How did you implement reviews? And what would you change?');
    await wait(25);
    const turns = [...service.turns.values()];
    assert.equal(turns.length, 3);
    assert.match(turns[1].answer, /reviews/);
    assert.match(turns[2].answer, /would you change/);
    assert.doesNotMatch(JSON.stringify(updates), /retries/);
    assert.equal(prompts.length, 4);
    assert.match(prompts[3][1].content, /reviews/);

    service.transcript('Them', 'Our data arrives as hourly batches.');
    const latest = [...service.turns.values()].at(-1);
    assert.equal(latest.status, 'suggested');
    service.answer(latest.id);
    await wait(25);
    assert.equal(latest.status, 'done');
    service.followup(latest.id, 'example');
    await wait(25);
    assert.equal([...service.turns.values()].at(-1).parentId, latest.id);

    rateLimitFlash = true;
    service.transcript('Them', 'How would you monitor that service?');
    await wait(25);
    assert.deepEqual(models.slice(-2), ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.equal([...service.turns.values()].at(-1).status, 'done');
    service.transcript('Them', 'What thresholds would you set?');
    await wait(25);
    assert.equal(models.at(-1), 'gemini-2.5-flash-lite');

    service.pause();
    assert.equal(service.setRepliesEnabled(true).success, false);
    service.transcript('Them', 'Are you still listening?');
    assert.equal(service.turns.size, 7);
});
