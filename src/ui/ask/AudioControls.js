import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';
import { startMicrophone, stopMicrophone } from '../listen/audioCore/listenCapture.js';

const sourceNames = { caller: 'Caller', mic: 'You', typed: 'You', followup: 'Follow-up' };
const privacySettings = {
    caller: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

// Lit inserts every variable as text, including unclosed code blocks arriving token by token.
function renderAnswer(text) {
    const blocks = [];
    let lines = [];
    let fence = '';
    let language = '';
    const flush = () => {
        if (fence) {
            blocks.push(html`<div class="code-block">${language ? html`<small>${language}</small>` : ''}<pre><code>${lines.join('\n')}</code></pre></div>`);
        } else if (lines.length) {
            blocks.push(html`<p>${lines.join('\n').trim()}</p>`);
        }
        lines = [];
    };
    for (const line of text.split(/\r?\n/)) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (!fence && marker) {
            flush();
            fence = marker[1];
            language = marker[2].trim().split(/\s+/)[0];
        } else if (fence && marker && marker[1].startsWith(fence) && !marker[2].trim()) {
            flush();
            fence = '';
            language = '';
        } else {
            lines.push(line);
        }
    }
    flush();
    return blocks;
}

function mergeById(snapshot, updates) {
    const records = new Map([...snapshot, ...updates].map(record => [record.id, record]));
    return [...records.values()];
}

export class AudioControls extends LitElement {
    static properties = {
        turns: { state: true }, speech: { state: true }, partials: { state: true },
        phase: { state: true }, callerActive: { state: true }, micActive: { state: true },
        sourceErrors: { state: true }, error: { state: true },
    };

    static styles = css`
        :host { display: block; min-width: 0; font: 13px/1.48 -apple-system, BlinkMacSystemFont, sans-serif; color: #f2f4f5; }
        #conversation { box-sizing: border-box; min-height: 64px; max-height: min(465px, calc(var(--ask-available-height, 640px) - 74px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #ffffff40 transparent; padding: 0 15px; user-select: text; }
        #conversation:focus-visible { outline: 1px solid #a4cdbf; outline-offset: -2px; }
        article { min-width: 0; padding: 10px 0; border-top: 1px solid #ffffff14; }
        article:first-child { border-top: 0; }
        .speaker, .answer-label { color: #b6c1c5; font-size: 11px; font-weight: 600; }
        .question, .transcript, .answer p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .question { font-size: 14px; line-height: 1.45; font-weight: 550; }
        .answer { margin-top: 8px; }
        .answer-label { color: #a9dfc8; }
        .partial { color: #d1d9dc; }
        .hint, .notice, .pending { color: #b5bdc1; font-size: 12px; margin: 4px 0; }
        .hint { padding: 16px 0; }
        .notice { color: #e7c5ac; }
        .code-block { margin: 7px 0; background: #0c1217; border: 1px solid #ffffff24; border-radius: 6px; }
        .code-block small { display: block; padding: 4px 8px; color: #a6b6bb; border-bottom: 1px solid #ffffff18; }
        pre { margin: 0; padding: 9px; overflow-x: auto; }
        code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; tab-size: 4; }
        button { color: #b6e4d4; font: inherit; font-size: 12px; background: transparent; border: none; padding: 2px 0; cursor: pointer; text-decoration: underline; }
        button:focus-visible { outline: 2px solid #a4cdbf; }
    `;

    constructor() {
        super();
        this.turns = [];
        this.speech = [];
        this.partials = {};
        this.phase = 'paused';
        this.callerActive = this.micActive = false;
        this.sourceErrors = {};
        this.error = '';
        this.generation = 0;
        this.resetCount = 0;
        this.followLatest = true;
        this.formattedAnswers = new WeakMap();
    }

    connectedCallback() {
        super.connectedCallback();
        const api = window.api.askView;
        api.onInterviewTurn(this.onTurn);
        api.onInterviewSpeech(this.onSpeech);
        api.onInterviewReset(this.onReset);
        api.onTranscript(this.onTranscript);
        api.onAudioShortcut(this.toggleListening);
        api.onAudioPaused(this.onAudioPaused);
        api.onCallerAudioStopped(this.onCallerStopped);
        const reset = this.resetCount;
        Promise.all([api.getInterviewTurns(), api.getInterviewSpeech()]).then(([turns, speech]) => {
            if (!this.isConnected || reset !== this.resetCount) return;
            this.turns = mergeById(turns, this.turns);
            this.speech = mergeById(speech, this.speech);
        }).catch(() => { this.error = 'Could not load the earlier conversation.'; });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        const api = window.api.askView;
        api.removeOnInterviewTurn(this.onTurn);
        api.removeOnInterviewSpeech(this.onSpeech);
        api.removeOnInterviewReset(this.onReset);
        api.removeOnTranscript(this.onTranscript);
        api.removeOnAudioShortcut(this.toggleListening);
        api.removeOnAudioPaused(this.onAudioPaused);
        api.removeOnCallerAudioStopped(this.onCallerStopped);
        this.pauseListening();
    }

    onReset = () => {
        this.resetCount++;
        this.turns = [];
        this.speech = [];
        this.partials = {};
        this.followLatest = true;
    };

    onTurn = (_, turn) => {
        this.turns = mergeById(this.turns, [turn]);
    };

    onSpeech = (_, segment) => {
        this.speech = mergeById(this.speech, [segment]);
    };

    onTranscript = (_, { speaker, text, isFinal, timestamp }) => {
        if (this.phase === 'paused' || !['Me', 'Them'].includes(speaker)) return;
        const source = speaker === 'Me' ? 'mic' : 'caller';
        const partials = { ...this.partials };
        if (isFinal || !text) delete partials[source];
        else partials[source] = { source, text, timestamp: partials[source]?.timestamp ?? timestamp ?? Date.now() };
        this.partials = partials;
    };

    get listening() { return this.phase === 'active' || this.phase === 'starting'; }

    toggleListening = () => this.listening ? this.pauseListening() : this.startListening();

    startListening() {
        if (!this.enabled || this.phase !== 'paused') return this.starting;
        const generation = ++this.generation;
        this.phase = 'starting';
        this.error = '';
        this.sourceErrors = {};
        this.callerStopped = false;
        this.starting = Promise.all(['caller', 'mic'].map(source => this.startSource(source, generation))).then(async () => {
            if (this.generation !== generation) return;
            if (this.callerActive || this.micActive) {
                this.phase = 'active';
            } else {
                if (Object.values(this.sourceErrors).some(problem => problem.connection)) {
                    this.sourceErrors = Object.fromEntries(Object.entries(this.sourceErrors).filter(([, problem]) => !problem.connection));
                    this.error = 'Could not connect to transcription. Check the speech provider in Glass Settings or your network, then select Resume.';
                }
                await this.pauseListening();
            }
        });
        return this.starting;
    }

    async startSource(source, generation) {
        let connected = false;
        try {
            await window.api.askView.beginAudio(source);
            connected = true;
            if (generation !== this.generation) return;
            if (source === 'mic') {
                const started = await startMicrophone({ onEnded: () => {
                    if (generation === this.generation) this.onSourceStopped('mic');
                } });
                if (generation === this.generation) this.micActive = started;
            } else {
                const result = await window.api.listenCapture.startMacosSystemAudio();
                if (!result?.success || this.callerStopped) throw new Error('System audio capture stopped.');
                if (generation === this.generation) this.callerActive = true;
            }
        } catch (error) {
            if (generation !== this.generation) return;
            const permission = /privacy|permission|notallowed|not allowed|denied/i.test(`${error.name} ${error.message}`);
            const message = source === 'caller' ? 'Caller audio unavailable.' : 'Microphone unavailable.';
            this.sourceErrors = { ...this.sourceErrors, [source]: { message, permission, connection: !connected && !permission } };
        }
    }

    onCallerStopped = () => this.onSourceStopped('caller');

    onSourceStopped(source) {
        if (!this.listening) return;
        if (source === 'caller') {
            this.callerStopped = true;
            this.callerActive = false;
        } else {
            this.micActive = false;
        }
        const partials = { ...this.partials };
        delete partials[source];
        this.partials = partials;
        const message = source === 'caller' ? 'Caller audio stopped.' : 'Microphone disconnected.';
        this.sourceErrors = { ...this.sourceErrors, [source]: { message, permission: source === 'caller' } };
        if (this.phase === 'active' && !this.micActive && !this.callerActive) this.pauseListening();
    }

    onAudioPaused = async (_, reason) => {
        if (typeof reason === 'string' && reason) this.error = reason;
        await this.pauseListening();
    };

    pauseListening() {
        if (this.phase === 'stopping') return this.stopping;
        if (!this.listening) return;
        this.stopping = this.stopSources();
        return this.stopping;
    }

    async stopSources() {
        // Invalidate any pending getUserMedia or permission response before draining both sources.
        ++this.generation;
        this.phase = 'stopping';
        const mic = this.micActive;
        this.micActive = this.callerActive = false;
        try {
            const finishMic = Promise.resolve(stopMicrophone({ flush: mic })).then(() => mic && window.api.askView.finishMicrophone());
            await Promise.allSettled([finishMic, window.api.listenCapture.stopMacosSystemAudio()]);
        } finally {
            try { await window.api.askView.endAudio(); }
            catch { this.error = 'Could not close the transcription connection.'; }
            this.partials = {};
            this.phase = 'paused';
        }
    }

    get status() {
        if (this.phase === 'starting') return 'Starting…';
        if (this.phase === 'stopping') return 'Pausing…';
        if (this.phase === 'paused') return 'Paused';
        if (Object.keys(this.partials).length) return 'Transcribing…';
        if (this.turns.some(turn => ['answering', 'queued'].includes(turn.status))) return 'Answering…';
        if (!this.micActive) return 'Caller only';
        if (!this.callerActive) return 'Mic only';
        return 'Listening';
    }

    updated(changed) {
        if (['phase', 'partials', 'callerActive', 'micActive', 'turns'].some(key => changed.has(key))) {
            const state = { phase: this.phase, listening: this.listening, status: this.status, caller: this.callerActive, mic: this.micActive };
            if (JSON.stringify(state) !== this.publishedState) {
                this.publishedState = JSON.stringify(state);
                this.dispatchEvent(new CustomEvent('capture-state', { detail: state, bubbles: true, composed: true }));
            }
        }
        this.scrollToLatest();
    }

    scrollToLatest() {
        const log = this.shadowRoot.getElementById('conversation');
        if (this.followLatest && log?.clientHeight) log.scrollTop = log.scrollHeight;
    }

    onScroll(event) {
        const log = event.currentTarget;
        if (log.clientHeight) this.followLatest = log.scrollHeight - log.clientHeight - log.scrollTop < 22;
    }

    scroll(direction) {
        const log = this.shadowRoot.getElementById('conversation');
        log.scrollBy({ top: (direction === 'up' ? -1 : 1) * Math.max(60, log.clientHeight * 0.75), behavior: 'smooth' });
    }

    async retry(turn) {
        try {
            const result = await window.api.askView.answerInterviewTurn(turn.id);
            if (!result?.success) throw new Error();
        } catch { this.error = 'Could not retry this answer.'; }
    }

    renderTurn(turn) {
        if (turn.answer && !this.formattedAnswers.has(turn)) this.formattedAnswers.set(turn, renderAnswer(turn.answer));
        return html`<article data-turn-id=${turn.id} data-source=${turn.source}>
            <span class="speaker">${sourceNames[turn.source] || 'Caller'}</span>
            <p class="question">${turn.question}</p>
            <div class="answer"><span class="answer-label">Glass</span>
                ${this.formattedAnswers.get(turn) || ''}
                ${!turn.answer && ['queued', 'answering'].includes(turn.status) ? html`<p class="pending">${turn.status === 'queued' ? 'Queued…' : 'Answering…'}</p>` : ''}
                ${turn.status === 'error' ? html`<p class="notice">${turn.error || 'Could not finish the answer.'}</p>` : ''}
                ${['error', 'suggested'].includes(turn.status) ? html`<button @click=${() => this.retry(turn)}>${turn.status === 'error' ? 'Retry' : 'Answer'}</button>` : ''}
            </div>
        </article>`;
    }

    render() {
        const answered = new Set(this.turns.flatMap(turn => turn.speechIds || []));
        const rows = [
            ...this.speech.filter(s => !answered.has(s.id)).map(s => ({ timestamp: s.timestamp, row: html`<article data-speech-id=${s.id} data-source=${s.source}>
                <span class="speaker">${sourceNames[s.source]}</span><p class="transcript">${s.text}</p></article>` })),
            ...this.turns.map(turn => ({ timestamp: turn.timestamp, row: this.renderTurn(turn) })),
            ...Object.values(this.partials).map(s => ({ timestamp: s.timestamp, row: html`<article class="partial" data-partial-source=${s.source}>
                <span class="speaker">${sourceNames[s.source]}</span><p class="transcript">${s.text}</p></article>` })),
        ];
        rows.sort((a, b) => a.timestamp - b.timestamp);
        return html`<div id="conversation" tabindex="0" role="region" aria-label="Conversation" @scroll=${this.onScroll}>
            ${rows.map(item => item.row)}
            ${!rows.length ? html`<p class="hint">${this.phase === 'active' ? 'Waiting for speech…' : this.phase === 'starting' ? 'Connecting audio…' : 'Type a question or resume listening.'}</p>` : ''}
            ${Object.entries(this.sourceErrors).map(([source, problem]) => html`<p class="notice">${problem.message}
                ${problem.permission ? html`<button @click=${() => window.api.common.openExternal(privacySettings[source])}>Open ${source === 'caller' ? 'screen recording' : 'microphone'} settings</button>` : ''}</p>`)}
            ${this.error ? html`<p class="notice" role="alert">${this.error}</p>` : ''}
        </div>`;
    }
}

customElements.define('ask-audio-controls', AudioControls);
