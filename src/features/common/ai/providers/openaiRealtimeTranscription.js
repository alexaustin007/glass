const WebSocket = require('ws');

const sampleRate = 24000;
const silenceToCommitMs = 360;
const minimumSpeechMs = 100;
const voiceThreshold = 200;

function chunkLevel(pcm) {
    let total = 0;
    for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
        total += pcm.readInt16LE(offset) ** 2;
    }
    return Math.sqrt(total / (pcm.length / 2));
}

async function createRealtimeTranscription({ apiKey, language = 'en', model = 'gpt-live-transcribe', callbacks, customVocabulary = [] }) {
    const manualCommit = model === 'gpt-live-transcribe';
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: 'Bearer ' + apiKey },
        handshakeTimeout: 10000,
    });
    let ready = false;
    let speechMs = 0;
    let silenceMs = 0;
    let pendingTurns = 0;
    const flushWaiters = new Set();
    const preRoll = [];

    const send = event => ws.send(JSON.stringify(event));
    const releaseFlush = () => {
        for (const finish of flushWaiters) finish();
    };
    const commit = () => {
        if (speechMs < minimumSpeechMs || ws.readyState !== WebSocket.OPEN) return;
        speechMs = 0;
        silenceMs = 0;
        pendingTurns++;
        send({ type: 'input_audio_buffer.commit' });
    };

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('OpenAI did not configure the transcription session in time.'));
            ws.terminate();
        }, 10000);

        ws.on('open', () => {
            const transcription = manualCommit
                ? {
                    model,
                    languages: [language.split(/[-_]/)[0]],
                    delay: 'low',
                    keywords: customVocabulary.filter(word => word.length <= 64 && !/[<>\r\n]/.test(word)).slice(0, 20),
                }
                : { model, language: language.split(/[-_]/)[0] };
            send({
                type: 'session.update',
                session: {
                    type: 'transcription',
                    audio: {
                        input: {
                            format: { type: 'audio/pcm', rate: sampleRate },
                            transcription,
                            turn_detection: manualCommit ? null : {
                                type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 360,
                            },
                        },
                    },
                },
            });
        });
        ws.on('message', bytes => {
            let event;
            try { event = JSON.parse(bytes.toString()); } catch { return; }
            if (event.type === 'session.updated') {
                clearTimeout(timer);
                ready = true;
                resolve();
            } else if (event.type === 'error' && !ready) {
                clearTimeout(timer);
                reject(new Error('OpenAI rejected transcription setup (' + (event.error?.code || 'unknown error') + ').'));
                ws.close();
            }
            callbacks.onmessage?.(event);
            if (pendingTurns && ['conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed'].includes(event.type)) {
                pendingTurns--;
                if (!pendingTurns) releaseFlush();
            }
        });
        ws.on('error', () => {
            clearTimeout(timer);
            const error = new Error('Could not connect to OpenAI live transcription.');
            if (!ready) reject(error);
            callbacks.onerror?.(error);
        });
        ws.on('close', code => {
            clearTimeout(timer);
            releaseFlush();
            if (!ready) reject(new Error('OpenAI closed the transcription connection (' + code + ').'));
            callbacks.onclose?.({ reason: String(code) });
        });
    });

    return {
        sendRealtimeInput(audio) {
            if (ws.readyState !== WebSocket.OPEN) return;
            const pcm = Buffer.from(audio, 'base64');
            if (!pcm.length) return;
            if (!manualCommit) {
                send({ type: 'input_audio_buffer.append', audio });
                return;
            }
            const durationMs = pcm.length * 1000 / (2 * sampleRate);
            const voiced = chunkLevel(pcm) >= voiceThreshold;
            // Keep consonants leading into the first voiced frame without uploading minutes of idle audio.
            if (!voiced && !speechMs) {
                preRoll.push(audio);
                if (preRoll.length > 2) preRoll.shift();
                return;
            }
            for (const frame of preRoll.splice(0)) send({ type: 'input_audio_buffer.append', audio: frame });
            send({ type: 'input_audio_buffer.append', audio });
            if (voiced) {
                speechMs += durationMs;
                silenceMs = 0;
            } else if (speechMs) {
                silenceMs += durationMs;
                if (silenceMs >= silenceToCommitMs) {
                    if (speechMs >= minimumSpeechMs) commit();
                    else {
                        speechMs = 0;
                        send({ type: 'input_audio_buffer.clear' });
                    }
                }
            }
        },
        async flush() {
            if (!manualCommit || ws.readyState !== WebSocket.OPEN) return;
            commit();
            if (!pendingTurns) return;
            await new Promise(resolve => {
                const finish = () => {
                    clearTimeout(timer);
                    flushWaiters.delete(finish);
                    resolve();
                };
                const timer = setTimeout(finish, 2500);
                flushWaiters.add(finish);
            });
        },
        keepAlive() {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
        },
        close() {
            ws.close();
        },
    };
}

module.exports = { createRealtimeTranscription };
