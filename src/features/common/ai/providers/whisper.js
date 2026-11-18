let execFile, EventEmitter;

if (typeof window === 'undefined') {
    execFile = require('node:child_process').execFile;
    EventEmitter = require('events').EventEmitter;
} else {
    class DummyEventEmitter {
        on() {}
        emit() {}
        removeAllListeners() {}
    }
    EventEmitter = DummyEventEmitter;
}

class WhisperSTTSession extends EventEmitter {
    constructor(model, whisperService, sessionId) {
        super();
        this.model = model;
        this.whisperService = whisperService;
        this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.process = null;
        this.processing = null;
        this.isRunning = false;
        this.audioBuffer = Buffer.alloc(0);
        this.processingInterval = null;
        this.lastTranscription = '';
    }

    async initialize() {
        try {
            await this.whisperService.ensureModelAvailable(this.model);
            this.isRunning = true;
            this.startProcessingLoop();
            return true;
        } catch (error) {
            console.error('[WhisperSTT] Initialization error:', error);
            this.emit('error', error);
            return false;
        }
    }

    startProcessingLoop() {
        this.processingInterval = setInterval(() => {
            const minBufferSize = 24000 * 2 * 0.15;
            if (this.audioBuffer.length >= minBufferSize) {
                this.processAudioChunk().catch(error => this.emit('error', error));
            }
        }, 1500);
    }

    processAudioChunk() {
        if (this.processing) return this.processing;
        if (!this.isRunning || this.audioBuffer.length === 0) return Promise.resolve();

        const audioData = this.audioBuffer;
        this.audioBuffer = Buffer.alloc(0);
        this.processing = this.transcribe(audioData).finally(() => { this.processing = null; });
        return this.processing;
    }

    async transcribe(audioData) {
        const tempFile = await this.whisperService.saveAudioToTemp(audioData, this.sessionId, 24000);
        try {
            const whisperPath = await this.whisperService.getWhisperPath();
            const modelPath = await this.whisperService.getModelPath(this.model);
            if (!this.isRunning) return;

            const output = await new Promise((resolve, reject) => {
                this.process = execFile(whisperPath, [
                    '-m', modelPath, '-f', tempFile, '--no-timestamps', '--language', 'auto', '--threads', '4',
                ], { timeout: 30000 }, (error, stdout) => {
                    if (error) reject(new Error('Whisper could not transcribe the recording.'));
                    else resolve(stdout);
                });
            });

            const text = output.trim();
            if (this.isRunning && text && text !== this.lastTranscription) {
                this.lastTranscription = text;
                this.emit('transcription', {
                    text, timestamp: Date.now(), confidence: 1.0, sessionId: this.sessionId,
                });
            }
        } finally {
            this.process = null;
            await this.whisperService.cleanupTempFile(tempFile);
        }
    }

    async flush() {
        try {
            await this.processing;
            await this.processAudioChunk();
        } finally {
            this.lastTranscription = '';
        }
    }

    sendRealtimeInput(audioData) {
        if (!this.isRunning) {
            console.warn(`[WhisperSTT-${this.sessionId}] Session not running, cannot accept audio`);
            return;
        }

        if (typeof audioData === 'string') {
            try {
                audioData = Buffer.from(audioData, 'base64');
            } catch (error) {
                console.error('[WhisperSTT] Failed to decode base64 audio data:', error);
                return;
            }
        } else if (audioData instanceof ArrayBuffer) {
            audioData = Buffer.from(audioData);
        } else if (!Buffer.isBuffer(audioData) && !(audioData instanceof Uint8Array)) {
            console.error('[WhisperSTT] Invalid audio data type:', typeof audioData);
            return;
        }

        if (!Buffer.isBuffer(audioData)) {
            audioData = Buffer.from(audioData);
        }

        if (audioData.length > 0) {
            this.audioBuffer = Buffer.concat([this.audioBuffer, audioData]);
            // Log every 10th audio chunk to avoid spam
            if (Math.random() < 0.1) {
                console.log(`[WhisperSTT-${this.sessionId}] Received audio chunk: ${audioData.length} bytes, total buffer: ${this.audioBuffer.length} bytes`);
            }
        }
    }

    async close() {
        console.log(`[WhisperSTT-${this.sessionId}] Closing session`);
        this.isRunning = false;

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }

        this.process?.kill('SIGTERM');
        await this.processing?.catch(() => {});
        this.audioBuffer = Buffer.alloc(0);

        this.removeAllListeners();
    }
}

class WhisperProvider {
    static async validateApiKey() {
        // Whisper is a local service, no API key validation needed.
        return { success: true };
    }

    constructor() {
        this.whisperService = null;
    }

    async initialize() {
        if (!this.whisperService) {
            this.whisperService = require('../../services/whisperService');
            if (!this.whisperService.isInitialized) {
                await this.whisperService.initialize();
            }
        }
    }

    async createSTT(config) {
        await this.initialize();
        
        const model = config.model || 'whisper-tiny';
        const sessionType = config.sessionType || 'unknown';
        console.log(`[WhisperProvider] Creating ${sessionType} STT session with model: ${model}`);
        
        // Create unique session ID based on type
        const sessionId = `${sessionType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const session = new WhisperSTTSession(model, this.whisperService, sessionId);
        
        // Log session creation
        console.log(`[WhisperProvider] Created session: ${sessionId}`);
        
        const initialized = await session.initialize();
        if (!initialized) {
            throw new Error('Failed to initialize Whisper STT session');
        }

        if (config.callbacks) {
            if (config.callbacks.onmessage) {
                session.on('transcription', config.callbacks.onmessage);
            }
            if (config.callbacks.onerror) {
                session.on('error', config.callbacks.onerror);
            }
            if (config.callbacks.onclose) {
                session.on('close', config.callbacks.onclose);
            }
        }

        return session;
    }

    async createLLM() {
        throw new Error('Whisper provider does not support LLM functionality');
    }

    async createStreamingLLM() {
        console.warn('[WhisperProvider] Streaming LLM is not supported by Whisper.');
        throw new Error('Whisper does not support LLM.');
    }
}

module.exports = {
    WhisperProvider,
    WhisperSTTSession
};
