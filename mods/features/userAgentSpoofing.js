const deviceProfiles = [
    {
        architecture: 'Linux arm64-v8a',
        os: 'Android 10',
        rasterizer: 'gles',
        manufacturer: 'Sony',
        deviceType: 'ATV',
        chipsetModel: 'sdm845',
        modelYear: 13140765,
        firmwareVersion: '52.1.C.0.268',
        brand: 'KDDI',
        model: 'SOV38'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 14',
        rasterizer: 'gles',
        manufacturer: 'Google',
        deviceType: 'ATV',
        chipsetModel: 'sabrina',
        modelYear: 2020,
        firmwareVersion: 'UTTC.250917.004',
        brand: 'google',
        model: 'Chromecast'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 12',
        rasterizer: 'gles',
        manufacturer: 'TCL',
        deviceType: 'ATV',
        chipsetModel: 'merak',
        modelYear: 2023,
        firmwareVersion: 'STT2.221228.001',
        brand: 'TCL',
        model: 'Smart TV Pro'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 7.1.2',
        rasterizer: 'gles',
        manufacturer: 'Amazon',
        deviceType: 'ATV',
        chipsetModel: 'mt8695',
        modelYear: 0,
        firmwareVersion: 'NS6294',
        brand: 'Amazon',
        model: 'AFTMM'
    }
]

const cobaltVersion = '25.lts.30.1034958-gold';
const v8Version = 'v8/8.8.278.17-jit';
const starboardVersion = '15';
const auxField = 'com.google.android.youtube.tv/5.30.301';
const USER_AGENT_APPLIED_SESSION_KEY = 'axotube-user-agent-applied';
const MAX_READY_ATTEMPTS = 120;
let readyAttempts = 0;

function generateUserAgent(profile) {
    return `Mozilla/5.0 (${profile.architecture}; ${profile.os}) Cobalt/${cobaltVersion} (unlike Gecko) ${v8Version} ${profile.rasterizer} Starboard/${starboardVersion}, ${profile.manufacturer}_${profile.deviceType}_${profile.chipsetModel}_${profile.modelYear}/${profile.firmwareVersion} (${profile.brand}, ${profile.model}) ${auxField}`;
}

function trySpoofUserAgent() {
    const api = window.h5vcc && window.h5vcc.tizentube;
    if (!document.querySelector('.content-container') || !api || typeof api.SetUserAgent !== 'function') {
        readyAttempts += 1;
        if (readyAttempts < MAX_READY_ATTEMPTS) setTimeout(trySpoofUserAgent, 250);
        return;
    }

    const ua = localStorage.getItem('userAgent');
    if (ua) {
        try {
            api.SetUserAgent(ua);
            if (sessionStorage.getItem(USER_AGENT_APPLIED_SESSION_KEY) !== ua) {
                sessionStorage.setItem(USER_AGENT_APPLIED_SESSION_KEY, ua);
                location.reload();
            }
        } catch (e) {
            console.warn('Failed to apply saved axotube user agent:', e);
        }
        return;
    }

    const randomProfile = deviceProfiles[Math.floor(Math.random() * deviceProfiles.length)];
    const spoofedUserAgent = generateUserAgent(randomProfile);
    try {
        localStorage.setItem('userAgent', spoofedUserAgent);
        api.SetUserAgent(spoofedUserAgent);
        sessionStorage.setItem(USER_AGENT_APPLIED_SESSION_KEY, spoofedUserAgent);
        location.reload();
    } catch (e) {
        console.warn('Failed to create/apply axotube user agent:', e);
    }
}

trySpoofUserAgent();
