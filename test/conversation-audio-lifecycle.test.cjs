const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('two inputs share one conversation, and a late permission grant cannot reopen a paused session', async t => {
    const bridge = new EventEmitter();
    const seen = [];
    let openCount = 0;
    let closeCount = 0;
    class Transcriber {
        setCallbacks(callbacks) { this.callbacks = callbacks; }
        isSessionActive() { return false; }
        async initializeSttSessions() { openCount++; }
        async closeSessions() { closeCount++; }
        stopMacOSAudioCapture() {}
    }
    const mocks = {
        electron: {},
        '../src/features/listen/stt/sttService': Transcriber,
        '../src/features/listen/summary/summaryService': class { setCallbacks() {} },
        '../src/features/common/services/authService': {},
        '../src/features/common/repositories/session': {},
        '../src/features/listen/stt/repositories': {},
        '../src/bridge/internalBridge': bridge,
        '../src/features/ask/interviewService': {
            resume: mode => seen.push(mode),
            pause: () => seen.push('paused'),
            interim: (text, speaker) => seen.push([text, speaker]),
            transcript: (speaker, text) => seen.push([speaker, text]),
        },
    };
    for (const [name, exports] of Object.entries(mocks)) {
        const id = require.resolve(name);
        const previous = require.cache[id];
        require.cache[id] = { id, exports, loaded: true };
        t.after(() => { if (previous) require.cache[id] = previous; else delete require.cache[id]; });
    }
    const listen = require('../src/features/listen/listenService');
    const generation = listen.askAudioGeneration;
    await Promise.all([listen.beginAskAudio(generation), listen.beginAskAudio(generation)]);
    assert.equal(openCount, 1);
    listen.sttService.callbacks.onCallerInterim('An example', 'Me');
    listen.sttService.callbacks.onTranscriptionComplete('Them', 'And why?');
    assert.deepEqual(seen, ['auto', ['An example', 'Me'], ['Them', 'And why?']]);
    await Promise.all([listen.endAskAudio(), listen.endAskAudio()]);
    assert.equal(closeCount, 1);
    assert.throws(() => listen.beginAskAudio(generation), /paused/);
    await listen.beginAskAudio();
    assert.equal(openCount, 2);
    assert.deepEqual(seen.slice(-2), ['paused', 'auto']);
    await listen.endAskAudio();
});
