const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('idle capture keeps a short lead-in, commits speech once and settles concurrent flushes', async t => {
    let socket;
    class TestSocket extends EventEmitter {
        static OPEN = 1;
        readyState = TestSocket.OPEN;
        sent = [];
        constructor() {
            super();
            socket = this;
            queueMicrotask(() => this.emit('open'));
        }
        send(json) {
            const event = JSON.parse(json);
            this.sent.push(event);
            if (event.type === 'session.update') {
                queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.updated' })));
            }
        }
        close() { this.emit('close', 1000); }
    }
    const wsId = require.resolve('ws');
    const previous = require.cache[wsId];
    require.cache[wsId] = { id: wsId, loaded: true, exports: TestSocket };
    t.after(() => { if (previous) require.cache[wsId] = previous; else delete require.cache[wsId]; });
    const { createRealtimeTranscription } = require('../src/features/common/ai/providers/openaiRealtimeTranscription');
    const session = await createRealtimeTranscription({ apiKey: 'unit-test', callbacks: {} });
    const frame = Buffer.alloc(4800);
    const quiet = frame.toString('base64');
    for (let i = 0; i < 100; i++) session.sendRealtimeInput(quiet);
    assert.equal(socket.sent.length, 1);
    for (let i = 0; i < frame.length; i += 2) frame.writeInt16LE(1400, i);
    session.sendRealtimeInput(frame.toString('base64'));
    for (let i = 0; i < 10; i++) session.sendRealtimeInput(quiet);
    assert.equal(socket.sent.filter(event => event.type === 'input_audio_buffer.append').length, 7);
    assert.equal(socket.sent.filter(event => event.type === 'input_audio_buffer.commit').length, 1);
    const flushes = Promise.all([session.flush(), session.flush()]);
    socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed' }));
    await flushes;
    session.close();
});
