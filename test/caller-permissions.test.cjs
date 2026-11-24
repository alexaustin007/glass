const { test } = require('node:test');
const assert = require('node:assert/strict');

test('macOS checks each capture permission only when needed', { skip: process.platform !== 'darwin' }, async t => {
    const status = { microphone: 'denied', screen: 'granted' };
    let prompts = 0;
    for (const [name, exports] of Object.entries({
        electron: { systemPreferences: {
            getMediaAccessStatus: source => status[source],
            askForMediaAccess: async () => { prompts++; return true; },
        } },
        '../src/features/common/repositories/permission': {},
    })) {
        const id = require.resolve(name);
        const previous = require.cache[id];
        require.cache[id] = { id, loaded: true, exports };
        t.after(() => { if (previous) require.cache[id] = previous; else delete require.cache[id]; });
    }
    const service = require('../src/features/common/services/permissionService');
    service._getAuthService = () => ({ getCurrentUserId: () => 'default_user' });
    assert.equal((await service.checkSystemPermissions()).needsSetup, false);
    await service.ensureAudioPermission('caller');
    await assert.rejects(service.ensureAudioPermission('mic'), /Privacy & Security → Microphone/);
    assert.equal(prompts, 0);
    status.microphone = 'not-determined';
    await service.ensureAudioPermission('caller');
    assert.equal(prompts, 0);
    await service.ensureAudioPermission('mic');
    assert.equal(prompts, 1);
    status.screen = 'denied';
    await assert.rejects(service.ensureAudioPermission('caller'), /Privacy & Security → Screen & System Audio Recording/);
    status.microphone = 'granted';
    await service.ensureAudioPermission('mic');
    assert.equal(prompts, 1);
    service.checkKeychainCompleted = async () => false;
    assert.equal((await service.checkSystemPermissions()).needsSetup, true);
    await assert.rejects(service.ensureAudioPermission('mic'), /keychain setup/);
});
