import { LitElement, html, css } from '../assets/lit-core-2.7.4.min.js';

export class PermissionHeader extends LitElement {
    static styles = css`
        :host {
            display: block;
            transition: opacity 0.3s ease-in, transform 0.3s ease-in;
            will-change: opacity, transform;
        }

        :host(.sliding-out) {
            opacity: 0;
            transform: translateY(-20px);
        }

        :host(.hidden) {
            opacity: 0;
            pointer-events: none;
        }

        * {
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        .container {
            -webkit-app-region: drag;
            width: 285px;
            /* height is now set dynamically */
            padding: 18px 20px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .container::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 16px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .close-button {
            -webkit-app-region: no-drag;
            position: absolute;
            top: 10px;
            right: 10px;
            width: 14px;
            height: 14px;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 3px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
            z-index: 10;
            font-size: 14px;
            line-height: 1;
            padding: 0;
        }

        .close-button:hover {
            background: rgba(255, 255, 255, 0.2);
            color: rgba(255, 255, 255, 0.9);
        }

        .close-button:active {
            transform: scale(0.95);
        }

        .title {
            color: white;
            font-size: 16px;
            font-weight: 500;
            margin: 0;
            text-align: center;
            flex-shrink: 0;
        }

        .form-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            margin-top: auto;
        }

        .form-content.all-granted {
            flex-grow: 1;
            justify-content: center;
            margin-top: 0;
        }

        .subtitle {
            color: rgba(255, 255, 255, 0.7);
            font-size: 11px;
            font-weight: 400;
            text-align: center;
            margin-bottom: 12px;
            line-height: 1.3;
        }

        .permission-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 12px;
            min-height: 20px;
        }

        .permission-item {
            display: flex;
            align-items: center;
            gap: 6px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 11px;
            font-weight: 400;
        }

        .permission-item.granted {
            color: rgba(34, 197, 94, 0.9);
        }

        .permission-icon {
            width: 12px;
            height: 12px;
            opacity: 0.8;
        }

        .check-icon {
            width: 12px;
            height: 12px;
            color: rgba(34, 197, 94, 0.9);
        }

        .action-button {
            -webkit-app-region: no-drag;
            width: 100%;
            height: 34px;
            background: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
            position: relative;
            overflow: hidden;
            margin-bottom: 6px;
        }

        .action-button::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 10px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .action-button:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.3);
        }

        .action-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .continue-button {
            -webkit-app-region: no-drag;
            width: 100%;
            height: 34px;
            background: rgba(34, 197, 94, 0.8);
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
            position: relative;
            overflow: hidden;
            margin-top: 4px;
        }

        .continue-button::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 10px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .continue-button:hover:not(:disabled) {
            background: rgba(34, 197, 94, 0.9);
        }

        .continue-button:disabled {
            background: rgba(255, 255, 255, 0.2);
            cursor: not-allowed;
        }
        
        /* ────────────────[ GLASS BYPASS ]─────────────── */
        :host-context(body.has-glass) .container,
        :host-context(body.has-glass) .action-button,
        :host-context(body.has-glass) .continue-button,
        :host-context(body.has-glass) .close-button {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            filter: none !important;
            backdrop-filter: none !important;
        }

        :host-context(body.has-glass) .container::after,
        :host-context(body.has-glass) .action-button::after,
        :host-context(body.has-glass) .continue-button::after {
            display: none !important;
        }

        :host-context(body.has-glass) .action-button:hover,
        :host-context(body.has-glass) .continue-button:hover,
        :host-context(body.has-glass) .close-button:hover {
            background: transparent !important;
        }
    `;

    static properties = {
        pending: { state: true },
        error: { state: true },
        continueCallback: { type: Function },
    };

    connectedCallback() {
        super.connectedCallback();
        this.checkKeychain();
        this.permissionCheckInterval = setInterval(() => this.checkKeychain(), 1000);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        clearInterval(this.permissionCheckInterval);
    }

    async checkKeychain() {
        if (!window.api || this.checking || this.continued) return;
        this.checking = true;
        try {
            const permissions = await window.api.permissionHeader.checkSystemPermissions();
            if (this.isConnected && permissions.keychain === 'granted' && this.continueCallback) {
                this.continued = true;
                await this.continueCallback();
            }
        } catch {
            this.continued = false;
            this.error = 'Could not check keychain access. Try again.';
        } finally {
            this.checking = false;
        }
    }

    async handleKeychainClick() {
        if (this.pending) return;
        this.pending = true;
        this.error = '';
        try {
            await window.api.permissionHeader.initializeEncryptionKey();
            await this.checkKeychain();
        } catch {
            this.error = 'Could not access the Glass encryption key. Try again.';
        } finally {
            this.pending = false;
        }
    }

    handleClose() {
        console.log('Close button clicked');
        if (window.api) {
            window.api.common.quitApplication();
        }
    }

    render() {
        return html`
            <div class="container" style="height: 220px">
                <button class="close-button" @click=${this.handleClose} title="Close application">
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" />
                    </svg>
                </button>
                <h1 class="title">Enable Glass encryption</h1>
                <div class="form-content">
                    <div class="subtitle">Allow Glass to use its encryption key in your Mac keychain.</div>
                    <button class="action-button" @click=${this.handleKeychainClick} ?disabled=${this.pending}>
                        ${this.pending ? 'Waiting for keychain…' : 'Enable encryption'}
                    </button>
                    ${this.error ? html`<div class="subtitle" role="alert">${this.error}</div>` : ''}
                </div>
            </div>
        `;
    }
}

customElements.define('permission-setup', PermissionHeader); 