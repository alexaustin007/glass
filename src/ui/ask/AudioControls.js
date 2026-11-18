import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';
import { startMicrophone, stopMicrophone } from '../listen/audioCore/listenCapture.js';

const shortcutLabels = { Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Option: '⌥' };

export class AudioControls extends LitElement {
    static properties = {
        callerActive: { state: true },
        micActive: { state: true },
        busy: { state: true },
        shortcuts: { state: true },
        callerText: { state: true },
        micText: { state: true },
        error: { state: true },
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
    `;

    constructor() {
        super();
        this.callerActive = false;
        this.micActive = false;
        this.busy = '';
        this.shortcuts = {};
        this.callerText = '';
        this.micText = '';
        this.error = '';
        this.generation = 0;
        this.micFinal = '';
        this.micPartial = '';
    }

    connectedCallback() {
        super.connectedCallback();
        const api = window.api.askView;
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
        api.removeOnAudioShortcut(this.onShortcut);
        api.removeOnAudioPaused(this.onPause);
        api.removeOnTranscript(this.onTranscript);
        api.removeOnCallerAudioStopped(this.onCallerStopped);
        api.removeOnShortcutsUpdated(this.onShortcutsUpdated);
        this.onPause();
    }

    onShortcutsUpdated = (_event, shortcuts) => { this.shortcuts = shortcuts; };
    onShortcut = (_event, source) => { this.toggleAudio(source); };

    onPause = () => {
        this.generation++;
        stopMicrophone();
        this.callerActive = false;
        this.micActive = false;
        this.insertVoiceQuestion();
        window.api.askView.endAudio().catch(console.error);
    };

    onCallerStopped = () => {
        this.callerActive = false;
        this.callerCaptureEnded = true;
        this.error = 'Caller audio stopped. Check Glass’s Screen & System Audio Recording permission.';
        if (!this.micActive && this.busy !== 'mic') window.api.askView.endAudio().catch(console.error);
    };

    onTranscript = (_event, { speaker, text, isFinal }) => {
        if (speaker === 'Them' && this.callerActive) this.callerText = text;
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
    }

    async toggleAudio(source) {
        if (this.busy || !['caller', 'mic'].includes(source)) return;

        const api = window.api.askView;
        const capture = window.api.listenCapture;
        const generation = this.generation;
        const isCaller = source === 'caller';
        const activeProperty = isCaller ? 'callerActive' : 'micActive';
        this.busy = source;
        this.error = '';
        try {
            if (this[activeProperty]) {
                if (isCaller) {
                    const result = await capture.stopMacosSystemAudio();
                    if (!result.success) throw new Error(result.error);
                } else {
                    stopMicrophone();
                    this.insertVoiceQuestion();
                }
                this[activeProperty] = false;
            } else {
                await api.beginAudio(source);
                if (generation !== this.generation) return;

                if (isCaller) {
                    this.callerCaptureEnded = false;
                    const result = await capture.startMacosSystemAudio();
                    if (!result.success || this.callerCaptureEnded) {
                        throw new Error(result.error || 'Caller audio stopped. Check Glass’s audio recording permission.');
                    }
                    if (generation !== this.generation) return;
                    this.callerText = '';
                } else if (!await startMicrophone() || generation !== this.generation) {
                    return;
                }
                this[activeProperty] = true;
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

    render() {
        return html`
            <div class="controls" aria-label="Audio controls">
                <button type="button" aria-pressed=${String(this.callerActive)} ?disabled=${!!this.busy}
                    @click=${() => this.toggleAudio('caller')}>
                    ${this.callerActive ? 'Stop listening' : 'Listen to caller'} ${this.renderShortcut('toggleCallerAudio')}
                </button>
                <button type="button" aria-pressed=${String(this.micActive)} ?disabled=${!!this.busy}
                    @click=${() => this.toggleAudio('mic')}>
                    ${this.micActive ? 'Stop speaking' : 'Speak'} ${this.renderShortcut('toggleMicrophone')}
                </button>
                <button type="button" ?disabled=${!this.callerText} @click=${() => this.dispatchEvent(new CustomEvent('caller-question', { detail: this.callerText }))}>
                    Ask about caller
                </button>
                <button type="button" @click=${() => window.api.mainHeader.sendAskButtonClick()}>
                    Hide Ask <kbd>⌃↵</kbd>
                </button>
            </div>
            ${this.busy ? html`<p class="status" role="status">${this.busy === 'caller' ? 'Updating caller audio…' : 'Updating microphone…'}</p>` : ''}
            ${this.callerText ? html`<p class="caption"><strong>Caller</strong> ${this.callerText}</p>` : ''}
            ${this.micText ? html`<p class="caption"><strong>You</strong> ${this.micText}</p>` : ''}
            ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        `;
    }
}

customElements.define('ask-audio-controls', AudioControls);
