import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';
import { startMicrophone, stopMicrophone } from '../listen/audioCore/listenCapture.js';

const shortcutLabels = { Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Option: '⌥' };

export class AudioControls extends LitElement {
    static properties = {
        callerActive: { state: true },
        micActive: { state: true },
        includeReplies: { state: true },
        replyMicActive: { state: true },
        replyText: { state: true },
        busy: { state: true },
        shortcuts: { state: true },
        callerText: { state: true },
        micText: { state: true },
        error: { state: true },
        turns: { state: true },
        selectedId: { state: true },
        showHistory: { state: true },
        pendingAction: { state: true },
    };

    static styles = css`
        :host { display: block; flex-shrink: 0; }
        .controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 9px 12px 0; }
        button {
            display: inline-flex; justify-content: space-between; align-items: center; gap: 4px; border-radius: 7px;
            min-height: 30px; padding: 4px 9px; background: rgba(255, 255, 255, .09);
            color: inherit; border: 1px solid rgba(255, 255, 255, .15);
            font: 500 12px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer;
        }
        button:hover:not(:disabled) { background: rgba(255, 255, 255, .18); }
        button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
        button:disabled { opacity: .55; cursor: default; }
        button[aria-pressed='true'] { background: rgba(153, 27, 27, .65); border-color: #fca5a5; }
        kbd, .status { color: #d1d5db; font-size: 11px; }
        .caption, .error, .status { margin: 8px 12px 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .caption { max-height: 96px; overflow-y: auto; user-select: text; }
        .error { color: #fecaca; }
        .controls .interview { background: #e0f4ee; border-color: #e0f4ee; color: #102c23; font-weight: 650; }
        .controls .interview kbd { color: inherit; opacity: .75; }
        .controls .interview:hover { background: #c8eedd; }
        .controls .interview[aria-pressed='true'] { color: #d4f9eb; border-color: #549e81; background: #203d32; }
        .controls button { min-height: 32px; }
        .live-hint, .status, .caption, .history, .answer, .error { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .live-hint { margin: 7px 12px 0; font-size: 11px; line-height: 1.45; color: #c4cbd1; }
        .caption { max-height: 56px; }
        .reply-option { display: flex; gap: 6px; align-items: center; margin: 6px 12px 0; color: #d8dfe2;
            font: 12px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
        .reply-option input { margin: 0; accent-color: #a8dcc7; }
        .reply-option small { margin-left: auto; color: #b4ebd4; }
        .caption strong { color: #b4ebd4; font-weight: 600; margin-right: 4px; }
        .history { margin: 7px 12px 0; display: grid; gap: 3px; max-height: 120px; overflow-y: auto; }
        .history button { width: 100%; gap: 8px; text-align: left; }
        .history .title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .history small { flex-shrink: 0; color: #bec9c4; }
        .history .selected { border-color: #83b9a4; }
        .answer { margin: 9px 12px 0; padding: 9px 0 0; border-top: 1px solid #ffffff26; }
        .answer-top, .followups { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .answer-top { justify-content: space-between; color: #b4ebd4; font-size: 11px; font-weight: 600; }
        .answer button { min-height: 24px; font-size: 11px; }
        .answer h3 { font-size: 13px; line-height: 1.45; margin: 5px 0; overflow-wrap: anywhere; }
        .answer-content { max-height: 185px; overflow-y: auto; user-select: text; }
        .answer-content p { font-size: 14px; line-height: 1.5; white-space: pre-wrap; margin: 0; overflow-wrap: anywhere; }
        .followups { margin-top: 7px; }
        .answer .status, .answer .error { margin: 4px 0; }
    `;

    constructor() {
        super();
        this.callerActive = false;
        this.micActive = false;
        this.includeReplies = false;
        this.replyMicActive = false;
        this.replyText = '';
        this.busy = '';
        this.shortcuts = {};
        this.callerText = '';
        this.micText = '';
        this.error = '';
        this.turns = [];
        this.selectedId = null;
        this.showHistory = false;
        this.pendingAction = false;
        this.turnRevision = 0;
        this.generation = 0;
        this.micFinal = '';
        this.micPartial = '';
    }

    connectedCallback() {
        super.connectedCallback();
        const api = window.api.askView;
        api.onInterviewTurn(this.onInterviewTurn);
        api.onInterviewReset(this.onInterviewReset);
        const revision = this.turnRevision;
        api.getInterviewTurns().then(turns => {
            if (this.isConnected && revision === this.turnRevision) this.turns = turns;
        }).catch(console.error);
        api.onAudioShortcut(this.onShortcut);
        api.onAudioPaused(this.onPause);
        api.onTranscript(this.onTranscript);
        api.onCallerAudioStopped(this.onCallerStopped);
        api.onShortcutsUpdated(this.onShortcutsUpdated);
        api.getShortcuts().then(shortcuts => { this.shortcuts = shortcuts; }).catch(console.error);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        const api = window.api.askView;
        api.removeOnInterviewTurn(this.onInterviewTurn);
        api.removeOnInterviewReset(this.onInterviewReset);
        api.removeOnAudioShortcut(this.onShortcut);
        api.removeOnAudioPaused(this.onPause);
        api.removeOnTranscript(this.onTranscript);
        api.removeOnCallerAudioStopped(this.onCallerStopped);
        api.removeOnShortcutsUpdated(this.onShortcutsUpdated);
        this.onPause();
    }

    onInterviewReset = () => {
        this.turnRevision++;
        this.turns = [];
        this.selectedId = null;
        this.showHistory = false;
        this.callerText = '';
    };

    onInterviewTurn = (_event, turn) => {
        this.turnRevision++;
        const turns = this.turns[0]?.id < turn.oldestId
            ? this.turns.filter(item => item.id >= turn.oldestId) : this.turns;
        if (this.selectedId !== null && this.selectedId < turn.oldestId) this.selectedId = null;
        this.turns = turns.some(item => item.id === turn.id)
            ? turns.map(item => item.id === turn.id ? turn : item)
            : [...turns, turn];
    };

    get latestAnswer() {
        // Keep a readable answer on screen until the next one has text.
        return this.turns.findLast(turn => turn.answer || turn.status === 'error')
            ?? this.turns.find(turn => turn.status === 'answering' || turn.status === 'queued')
            ?? this.turns.at(-1);
    }

    async requestTurn(turn, kind) {
        if (this.pendingAction) return;
        this.pendingAction = true;
        this.error = '';
        try {
            const api = window.api.askView;
            const result = kind ? await api.requestInterviewFollowup(turn.id, kind) : await api.answerInterviewTurn(turn.id);
            if (!result.success) throw new Error(result.error || 'Could not request an answer.');
            this.selectedId = result.id;
            this.showHistory = false;
        } catch (error) {
            this.error = error.message;
        } finally {
            this.pendingAction = false;
        }
    }

    onShortcutsUpdated = (_event, shortcuts) => { this.shortcuts = shortcuts; };
    onShortcut = (_event, source) => { this.toggleAudio(source); };

    onPause = () => {
        this.generation++;
        stopMicrophone();
        this.callerActive = false;
        this.micActive = false;
        this.replyMicActive = false;
        this.replyText = '';
        this.insertVoiceQuestion();
        window.api.askView.endAudio().catch(console.error);
    };

    onCallerStopped = () => {
        this.callerActive = false;
        this.callerCaptureEnded = true;
        this.stopReplyMicrophone(false).catch(console.error);
        this.error = 'Caller audio stopped. Check Glass’s Screen & System Audio Recording permission.';
        if (!this.micActive && this.busy !== 'mic') window.api.askView.endAudio().catch(console.error);
    };

    onTranscript = (_event, { speaker, text, isFinal }) => {
        if (speaker === 'Them' && (this.callerActive || this.busy === 'caller')) this.callerText = text;
        if (speaker === 'Me' && this.replyMicActive) this.replyText = text;
        if (speaker !== 'Me' || !this.micActive) return;

        if (isFinal) {
            this.micFinal = [this.micFinal, text].filter(Boolean).join(' ');
            this.micPartial = '';
        } else {
            this.micPartial = text;
        }
        this.micText = [this.micFinal, this.micPartial].filter(Boolean).join(' ');
    };

    insertVoiceQuestion() {
        const text = this.micText.trim();
        this.micFinal = this.micPartial = this.micText = '';
        if (text) this.dispatchEvent(new CustomEvent('voice-question', { detail: text }));
        return !!text;
    }

    async startReplyMicrophone() {
        if (!this.callerActive || !this.includeReplies || this.micActive) return;
        const api = window.api.askView;
        this.replyMicActive = true;
        this.replyText = '';
        try {
            await api.beginAudio('mic');
            if (!this.replyMicActive) return;
            const result = await api.setInterviewRepliesEnabled(true);
            if (!result?.success) throw new Error('Start an interview to include your replies.');
            if (this.replyMicActive) await startMicrophone();
        } catch (error) {
            await this.stopReplyMicrophone(false);
            this.includeReplies = false;
            throw error;
        }
    }

    async stopReplyMicrophone(flush) {
        if (!this.replyMicActive) return;
        const api = window.api.askView;
        this.replyMicActive = false;
        this.replyText = '';
        try {
            await stopMicrophone({ flush });
            if (flush) await api.finishMicrophone();
        } finally {
            await api.setInterviewRepliesEnabled(false);
        }
    }

    async changeIncludeReplies(event) {
        this.includeReplies = event.target.checked;
        if (!this.callerActive || this.micActive) return;
        this.busy = 'reply-mic';
        this.error = '';
        try {
            if (this.includeReplies) await this.startReplyMicrophone();
            else await this.stopReplyMicrophone(true);
        } catch (error) {
            this.error = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
        } finally {
            this.busy = '';
        }
    }

    async toggleAudio(source) {
        if (this.busy || !['caller', 'mic'].includes(source)) return;

        const api = window.api.askView;
        const capture = window.api.listenCapture;
        const generation = this.generation;
        const isCaller = source === 'caller';
        const activeProperty = isCaller ? 'callerActive' : 'micActive';
        this.busy = !isCaller && this.micActive ? 'mic-stopping' : source;
        this.error = '';
        try {
            if (this[activeProperty]) {
                if (isCaller) {
                    const results = await Promise.allSettled([
                        capture.stopMacosSystemAudio(),
                        this.stopReplyMicrophone(false),
                    ]);
                    if (results[0].status === 'rejected') throw results[0].reason;
                    if (!results[0].value.success) throw new Error(results[0].value.error);
                    this.callerActive = false;
                    if (results[1].status === 'rejected') throw results[1].reason;
                } else {
                    try {
                        await stopMicrophone({ flush: true });
                        if (generation === this.generation) await api.finishMicrophone();
                    } finally {
                        if (generation === this.generation && !this.insertVoiceQuestion()) {
                            this.error = 'No speech was transcribed. Check your input in System Settings → Sound.';
                        }
                        this.micActive = false;
                        if (generation === this.generation) await this.startReplyMicrophone();
                    }
                }
                this[activeProperty] = false;
            } else {
                // Drain the reply turn before routing new microphone words into a draft.
                if (!isCaller) await this.stopReplyMicrophone(true);
                if (generation !== this.generation) return;
                await api.beginAudio(source);
                if (generation !== this.generation) return;

                if (isCaller) {
                    this.callerCaptureEnded = false;
                    this.callerText = '';
                    const result = await capture.startMacosSystemAudio();
                    if (!result.success || this.callerCaptureEnded) {
                        throw new Error(result.error || 'Caller audio stopped. Check Glass’s audio recording permission.');
                    }
                    if (generation !== this.generation) return;
                } else if (!await startMicrophone() || generation !== this.generation) {
                    return;
                }
                this[activeProperty] = true;
                if (isCaller) await this.startReplyMicrophone();
            }
        } catch (error) {
            if (generation === this.generation) {
                this.error = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
            }
        } finally {
            if (!this.callerActive && !this.micActive) await api.endAudio().catch(console.error);
            this.busy = '';
        }
    }

    renderShortcut(action) {
        const accelerator = this.shortcuts[action];
        if (!accelerator) return '';
        return html`<kbd title=${accelerator}>${accelerator.split('+').map(key => shortcutLabels[key] || key).join('')}</kbd>`;
    }

    updated(changes) {
        if (changes.has('callerActive')) {
            this.dispatchEvent(new CustomEvent('caller-audio-state', {
                detail: this.callerActive, bubbles: true, composed: true,
            }));
        }
    }

    renderHistory(selected) {
        const labels = { suggested: 'Available', queued: 'Queued', answering: 'Answering', done: 'Answered', error: 'Retry' };
        return html`<nav class="history" id="question-history" aria-label="Caller questions">
            ${this.turns.slice().reverse().map(turn => html`
                <button class=${turn.id === selected?.id ? 'selected' : ''} title=${turn.question}
                    @click=${() => { this.selectedId = turn.id; this.showHistory = false; }}>
                    <span class="title">${turn.question}</span><small>${labels[turn.status]}</small>
                </button>`)}
        </nav>`;
    }

    renderAnswer(turn) {
        if (!turn) return '';
        return html`<section class="answer" aria-label="Interview answer">
            <div class="answer-top">
                <span>${this.selectedId === null ? 'Live answer' : 'Selected question'}</span>
                ${this.selectedId !== null ? html`<button @click=${() => { this.selectedId = null; }}>Follow latest</button>` : ''}
            </div>
            <div class="answer-content">
                <h3>${turn.question}</h3>
                ${turn.answer ? html`<p>${turn.answer}</p>` : ''}
            </div>
            ${turn.status === 'queued' || turn.status === 'answering' && !turn.answer
                ? html`<div class="status" role="status">${turn.status === 'queued' ? 'Queued…' : 'Answering…'}</div>` : ''}
            ${turn.status === 'error' ? html`<p class="error" role="alert">${turn.error || 'Could not finish this answer.'}</p>` : ''}
            ${turn.status === 'suggested' || turn.status === 'error' ? html`
                <div class="followups"><button ?disabled=${this.pendingAction} @click=${() => this.requestTurn(turn)}>
                    ${turn.status === 'error' ? 'Try again' : 'Answer this'}</button></div>` : ''}
            ${turn.status === 'done' ? html`<div class="followups" aria-label="Follow-up suggestions">
                <button ?disabled=${this.pendingAction} @click=${() => this.requestTurn(turn, 'example')}>Give an example</button>
                <button ?disabled=${this.pendingAction} @click=${() => this.requestTurn(turn, 'detail')}>Go deeper</button>
            </div>` : ''}
        </section>`;
    }

    render() {
        const selected = this.turns.find(turn => turn.id === this.selectedId) ?? this.latestAnswer;
        const status = {
            caller: this.callerActive ? 'Finishing caller captions…' : 'Connecting caller audio…',
            mic: 'Starting microphone…',
            'mic-stopping': 'Finishing dictation…',
            'reply-mic': this.includeReplies ? 'Starting reply microphone…' : 'Finishing your reply…',
        }[this.busy];
        return html`
            <div class="controls" aria-label="Interview controls">
                <button type="button" class="interview" aria-pressed=${String(this.callerActive)} ?disabled=${!!this.busy}
                    title="Listen to the caller and answer questions automatically" @click=${() => this.toggleAudio('caller')}>
                    ${this.callerActive ? 'Stop interview' : 'Start interview'} ${this.renderShortcut('toggleCallerAudio')}
                </button>
                <button type="button" aria-pressed=${String(this.micActive)} ?disabled=${!!this.busy}
                    title="Dictate your own question" @click=${() => this.toggleAudio('mic')}>
                    ${this.micActive ? 'Stop speaking' : 'Speak'} ${this.renderShortcut('toggleMicrophone')}
                </button>
                <button type="button" ?disabled=${!this.turns.length} aria-expanded=${String(this.showHistory)}
                    aria-controls="question-history" @click=${() => { this.showHistory = !this.showHistory; }}>
                    Questions ${this.turns.length ? html`<kbd>${this.turns.length}</kbd>` : ''}
                </button>
                <button type="button" @click=${() => window.api.mainHeader.sendAskButtonClick()}>
                    Hide Ask <kbd>⌃↵</kbd>
                </button>
            </div>
            <label class="reply-option" title="Use your microphone to add your spoken replies to the interview context">
                <input type="checkbox" .checked=${this.includeReplies} ?disabled=${!!this.busy} @change=${this.changeIncludeReplies} />
                Include my replies
                ${this.replyMicActive ? html`<small>Mic on</small>` : ''}
            </label>
            ${this.showHistory ? this.renderHistory(selected) : ''}
            ${status ? html`<p class="status" role="status">${status}</p>` : ''}
            ${!this.turns.length && !this.callerText && !status && !this.error && !this.micActive ? html`
                <p class="live-hint">${this.callerActive ? 'Listening for the caller’s question…' : 'Start interview for live caller captions and answers.'}</p>` : ''}
            ${this.callerText ? html`<p class="caption"><strong>Caller</strong> ${this.callerText}</p>` : ''}
            ${this.replyMicActive && this.replyText ? html`<p class="caption"><strong>Your reply</strong> ${this.replyText}</p>` : ''}
            ${this.micText ? html`<p class="caption"><strong>Your draft</strong> ${this.micText}</p>` : ''}
            ${this.error ? html`<p class="error" role="alert">${this.error}</p>
                ${/Screen & System Audio Recording|Privacy.*Microphone/i.test(this.error) ? html`
                    <button type="button" @click=${() => window.api.common.openExternal(
                        this.error.includes('Screen & System Audio Recording')
                            ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
                            : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
                    )}>Open Privacy Settings</button>` : ''}` : ''}
            ${this.renderAnswer(selected)}
        `;
    }
}

customElements.define('ask-audio-controls', AudioControls);
