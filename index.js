/**
 * SillyImages + Wardrobe
 * Combined: inline image generation + outfit management
 */

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  MODULE: SillyWardrobe                                        ║
   ╚═══════════════════════════════════════════════════════════════╝ */

(function initWardrobe() {
    'use strict';
    const SW = 'silly_wardrobe';

    function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 8); }
    function swLog(l, ...a) { (l === 'ERROR' ? console.error : l === 'WARN' ? console.warn : console.log)('[SW]', ...a); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

    const swDefaults = Object.freeze({ wardrobes: {}, activeOutfits: {}, maxDimension: 512, showFloatingBtn: false });

    function swGetSettings() {
        const ctx = SillyTavern.getContext();
        if (!ctx.extensionSettings[SW]) ctx.extensionSettings[SW] = structuredClone(swDefaults);
        const s = ctx.extensionSettings[SW];
        for (const k of Object.keys(swDefaults)) if (!Object.hasOwn(s, k)) s[k] = swDefaults[k];
        return s;
    }
    function swSave() { SillyTavern.getContext().saveSettingsDebounced(); }

    function swCharName() {
        const ctx = SillyTavern.getContext();
        return (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) ? (ctx.characters[ctx.characterId].name || '') : '';
    }

    function swGetWardrobe(cn) { const s = swGetSettings(); if (!s.wardrobes[cn]) s.wardrobes[cn] = { bot: [], user: [] }; return s.wardrobes[cn]; }
    function swGetActive() { const cn = swCharName(); if (!cn) return { bot: null, user: null }; const s = swGetSettings(); if (!s.activeOutfits[cn]) s.activeOutfits[cn] = { bot: null, user: null }; return s.activeOutfits[cn]; }
    function swSetActive(type, id) { const cn = swCharName(); if (!cn) { toastr.error('Персонаж не выбран', 'Гардероб'); return false; } const s = swGetSettings(); if (!s.activeOutfits[cn]) s.activeOutfits[cn] = { bot: null, user: null }; s.activeOutfits[cn][type] = id; swSave(); return true; }
    function swFind(cn, type, id) { return swGetWardrobe(cn)[type].find(o => o.id === id) || null; }
    function swAdd(cn, type, o) { swGetWardrobe(cn)[type].push(o); swSave(); }
    function swRemove(cn, type, id) { const w = swGetWardrobe(cn); w[type] = w[type].filter(o => o.id !== id); swSave(); if (swGetActive()[type] === id) { swSetActive(type, null); swUpdatePromptInjection(); } }

    function swResize(file, maxDim) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = (e) => { const img = new Image(); img.onload = () => { let { width: w, height: h } = img; if (w > maxDim || h > maxDim) { const s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ base64: c.toDataURL('image/png').split(',')[1] }); }; img.onerror = () => rej(new Error('decode')); img.src = e.target.result; };
            r.onerror = () => rej(new Error('read')); r.readAsDataURL(file);
        });
    }

    // ── Modal ──
    let swOpen = false, swTab = 'bot';

    function swOpenModal() {
        swCloseModal();
        swOpen = true;
        const cn = swCharName();
        if (!cn) { toastr.warning('Выберите персонажа', 'Гардероб'); swOpen = false; return; }

        const ov = document.createElement('div'); ov.id = 'sw-modal-overlay';
        ov.addEventListener('click', (e) => { if (e.target === ov) swCloseModal(); });

        const m = document.createElement('div'); m.id = 'sw-modal';
        m.innerHTML = `
            <div class="sw-modal-header">
                <span>Гардероб — <b>${esc(cn)}</b></span>
                <div class="sw-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="sw-tabs">
                <div class="sw-tab ${swTab === 'bot' ? 'sw-tab-active' : ''}" data-tab="bot">Бот</div>
                <div class="sw-tab ${swTab === 'user' ? 'sw-tab-active' : ''}" data-tab="user">Юзер</div>
            </div>
            <div class="sw-active-info" id="sw-active-info"></div>
            <div class="sw-tab-content" id="sw-tab-content"></div>`;

        ov.appendChild(m);
        document.body.appendChild(ov);
        m.querySelector('.sw-modal-close').addEventListener('click', swCloseModal);
        for (const t of m.querySelectorAll('.sw-tab')) t.addEventListener('click', () => {
            swTab = t.dataset.tab; m.querySelectorAll('.sw-tab').forEach(x => x.classList.toggle('sw-tab-active', x.dataset.tab === swTab)); swRender();
        });
        swRender();
        document.addEventListener('keydown', swEsc);
    }
    function swEsc(e) { if (e.key === 'Escape') swCloseModal(); }
    function swCloseModal() { swOpen = false; document.getElementById('sw-modal-overlay')?.remove(); document.removeEventListener('keydown', swEsc); }

    function swRender() {
        const c = document.getElementById('sw-tab-content'), ib = document.getElementById('sw-active-info');
        if (!c) return;
        const cn = swCharName(), outfits = swGetWardrobe(cn)[swTab] || [], aid = swGetActive()[swTab];

        if (ib) {
            const ao = aid ? swFind(cn, swTab, aid) : null;
            ib.innerHTML = ao ? `Активно: <b>${esc(ao.name)}</b>${ao.description ? ` — <i>${esc(ao.description.length > 60 ? ao.description.slice(0, 60) + '...' : ao.description)}</i>` : ''}` : 'Ничего не надето';
            ib.classList.toggle('sw-active-visible', !!ao);
        }

        let h = '<div class="sw-outfit-grid"><div class="sw-outfit-card sw-upload-card" id="sw-upload-trigger"><div class="sw-upload-icon"><i class="fa-solid fa-plus"></i></div><span>Загрузить</span></div>';
        for (const o of outfits) {
            const a = o.id === aid;
            h += `<div class="sw-outfit-card ${a ? 'sw-outfit-active' : ''}" data-id="${o.id}">
                <div class="sw-outfit-img-wrap"><img src="data:image/png;base64,${o.base64}" alt="${esc(o.name)}" class="sw-outfit-img" loading="lazy">${a ? '<div class="sw-active-badge"><i class="fa-solid fa-check"></i></div>' : ''}</div>
                <div class="sw-outfit-footer"><span class="sw-outfit-name" title="${esc(o.description || o.name)}">${esc(o.name)}</span>
                    <div class="sw-outfit-btns">
                        <div class="sw-btn-activate" title="${a ? 'Снять' : 'Надеть'}"><i class="fa-solid ${a ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></div>
                        <div class="sw-btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></div>
                        <div class="sw-btn-delete" title="Удалить"><i class="fa-solid fa-trash-can"></i></div>
                    </div></div></div>`;
        }
        h += '</div>'; c.innerHTML = h;

        document.getElementById('sw-upload-trigger')?.addEventListener('click', swUpload);
        for (const card of c.querySelectorAll('.sw-outfit-card[data-id]')) {
            const id = card.dataset.id;
            card.querySelector('.sw-outfit-img')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-btn-activate')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-btn-edit')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swEdit(cn, swTab, id); });
            card.querySelector('.sw-btn-delete')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (confirm('Удалить?')) { swRemove(cn, swTab, id); swRender(); toastr.info('Удалён', 'Гардероб'); } });
        }
    }

    function swToggle(id) {
        const a = swGetActive(), cn = swCharName(), o = swFind(cn, swTab, id), nm = o?.name || id;
        const off = a[swTab] === id;
        if (swSetActive(swTab, off ? null : id) === false) return;
        swRender();
        swUpdatePromptInjection();
        swInjectFloatingBtn();
        off ? toastr.info(`«${nm}» снят`, 'Гардероб', { timeOut: 2000 }) : toastr.success(`«${nm}» надет`, 'Гардероб', { timeOut: 2000 });
    }

    /**
     * Analyze outfit image via vision model.
     * Uses generateRaw with a CLEAN message array (no chat context) to prevent
     * the model from continuing RP instead of describing clothing.
     */
    async function swAnalyzeOutfit(base64) {
        const ctx = SillyTavern.getContext();

        // Strategy 1: generateRaw with isolated vision messages (NO chat context)
        if (typeof ctx.generateRaw === 'function') {
            try {
                toastr.info('Анализ образа...', 'Гардероб', { timeOut: 15000 });
                const messages = [
                    {
                        role: 'system',
                        content: 'You are a fashion catalog assistant. You ONLY describe clothing. You never roleplay, narrate, or write fiction. Respond with 1-2 sentences in English describing ONLY the garments, colors, fabrics, accessories, and shoes visible in the image. Nothing else.'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
                            { type: 'text', text: 'Describe the clothing in this image.' },
                        ],
                    },
                ];
                const result = await ctx.generateRaw({ prompt: messages, maxTokens: 150 });
                const desc = (result || '').trim()
                    // Strip any accidental markdown/quotes
                    .replace(/^["'`]+|["'`]+$/g, '')
                    .replace(/^(Here|This|The image|I see|In this).{0,20}(shows?|features?|depicts?|displays?)\s*/i, '');
                if (desc && desc.length > 10 && desc.length < 500) {
                    swLog('INFO', 'Auto-described via generateRaw:', desc.substring(0, 100));
                    return desc;
                }
            } catch (e) {
                swLog('WARN', 'generateRaw vision failed:', e.message);
            }
        }

        // Strategy 2: generateQuietPrompt fallback (sends chat context, might RP)
        if (typeof ctx.generateQuietPrompt === 'function') {
            try {
                toastr.info('Анализ образа (fallback)...', 'Гардероб', { timeOut: 15000 });
                const result = await ctx.generateQuietPrompt({
                    quietPrompt: '[OOC: STOP ROLEPLAY. You are now a fashion assistant. Describe ONLY the clothing visible in the attached image in 1-2 sentences in English. List garments, colors, fabrics, accessories, shoes. Do NOT write any narrative, dialogue, or RP content.]',
                    quietImage: `data:image/png;base64,${base64}`,
                    maxTokens: 150,
                });
                const desc = (result || '').trim()
                    .replace(/^["'`]+|["'`]+$/g, '');
                if (desc && desc.length > 10 && desc.length < 500) {
                    swLog('INFO', 'Auto-described via quietPrompt:', desc.substring(0, 100));
                    return desc;
                }
            } catch (e) {
                swLog('WARN', 'generateQuietPrompt failed:', e.message);
            }
        }

        swLog('WARN', 'Auto-describe unavailable');
        return null;
    }

    async function swUpload() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.addEventListener('change', async () => {
            const f = inp.files?.[0]; if (!f) return;
            const name = prompt('Название:', f.name.replace(/\.[^.]+$/, '')); if (!name?.trim()) return;
            try {
                const { base64 } = await swResize(f, swGetSettings().maxDimension);

                // Auto-analyze image to generate description
                let autoDesc = await swAnalyzeOutfit(base64);
                // Let user edit/confirm the generated description
                const desc = prompt('Описание образа (авто-сгенерировано, можете отредактировать):', autoDesc || '') || '';

                swAdd(swCharName(), swTab, { id: uid(), name: name.trim(), description: desc.trim(), base64, addedAt: Date.now() });
                swRender(); toastr.success(`«${name.trim()}» добавлен`, 'Гардероб');
            } catch (e) { toastr.error('Ошибка: ' + e.message, 'Гардероб'); }
        });
        inp.click();
    }

    async function swEdit(cn, type, id) {
        const o = swFind(cn, type, id); if (!o) return;
        const n = prompt('Название:', o.name); if (n === null) return;

        // Offer to re-analyze image
        let currentDesc = o.description || '';
        const reAnalyze = confirm('Пере-анализировать образ через ИИ?\n\nОК = да (текущее описание заменится)\nОтмена = редактировать вручную');
        if (reAnalyze) {
            const autoDesc = await swAnalyzeOutfit(o.base64);
            if (autoDesc) currentDesc = autoDesc;
        }

        const d = prompt('Описание:', currentDesc); if (d === null) return;
        o.name = n.trim() || o.name; o.description = d.trim(); swSave(); swRender(); swUpdatePromptInjection(); toastr.info('Обновлён', 'Гардероб');
    }

    // ── Prompt injection: outfit descriptions into main RP chat ──

    const SW_PROMPT_KEY = 'sillywardrobe_outfit';

    /**
     * Update the prompt injection with current active outfit descriptions.
     * Called on toggle, chat change, and app ready.
     */
    function swUpdatePromptInjection() {
        try {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.setExtensionPrompt !== 'function') {
                swLog('WARN', 'setExtensionPrompt not available');
                return;
            }

            const cn = swCharName();
            if (!cn) {
                ctx.setExtensionPrompt(SW_PROMPT_KEY, '', 1, 1);
                return;
            }

            const botData = swGetActive().bot ? swFind(cn, 'bot', swGetActive().bot) : null;
            const userData = swGetActive().user ? swFind(cn, 'user', swGetActive().user) : null;

            const lines = [];
            if (botData?.description) lines.push(`[${cn} сейчас одет(а): ${botData.description}]`);
            if (userData?.description) lines.push(`[{{user}} сейчас одет(а): ${userData.description}]`);

            const injectionText = lines.length > 0 ? lines.join('\n') : '';

            // position 1 = IN_CHAT, depth 1 = before last message (like Author's Note)
            ctx.setExtensionPrompt(SW_PROMPT_KEY, injectionText, 1, 1);

            if (injectionText) {
                swLog('INFO', `Prompt injection updated: ${lines.length} outfit(s)`);
            } else {
                swLog('INFO', 'Prompt injection cleared (no active outfits)');
            }
        } catch (e) {
            swLog('ERROR', 'Failed to update prompt injection:', e.message);
        }
    }

    // ── Bar button (inline in leftSendForm, like sims-action-btn) ──

    function swInjectFloatingBtn() {
        let $btn = $('#sw-bar-btn');
        if ($btn.length === 0) {
            $btn = $('<div id="sw-bar-btn" title="Гардероб"><i class="fa-solid fa-shirt"></i></div>');
            $btn.on('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                swOpenModal();
            });
            const $left = $('#leftSendForm');
            if ($left.length) $left.append($btn);
            else $('body').append($btn);
        }
        const active = swGetActive();
        const hasActive = !!(active.bot || active.user);
        $btn.toggleClass('sw-bar-active', hasActive);
        if (hasActive) {
            let count = 0;
            if (active.bot) count++;
            if (active.user) count++;
            $btn.html(`<i class="fa-solid fa-shirt"></i><span class="sw-bar-count">${count}</span>`);
        } else {
            $btn.html('<i class="fa-solid fa-shirt"></i>');
        }
        $btn.show();
    }

    // ── Public API ──
    window.sillyWardrobe = {
        getActiveOutfitBase64(type) { const cn = swCharName(); if (!cn) return null; const a = swGetActive(); return a[type] ? (swFind(cn, type, a[type])?.base64 || null) : null; },
        getActiveOutfitDataUrl(type) { const b = this.getActiveOutfitBase64(type); return b ? `data:image/png;base64,${b}` : null; },
        getActiveOutfitData(type) { const cn = swCharName(); if (!cn) return null; const a = swGetActive(); return a[type] ? swFind(cn, type, a[type]) : null; },
        openModal: () => swOpenModal(),
        isReady: () => true,
    };

    // ── Init hooks ──
    const ctx = SillyTavern.getContext();

    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        setTimeout(() => { swUpdatePromptInjection(); swInjectFloatingBtn(); }, 500);
    });

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => { swUpdatePromptInjection(); swInjectFloatingBtn(); }, 300);
    });

    swLog('INFO', 'SillyWardrobe initialized');
})();


/* ╔═══════════════════════════════════════════════════════════════╗
   ║  MODULE: SillyImages (Inline Image Generation)                ║
   ║  Original: github.com/0xl0cal/sillyimages                    ║
   ║  + user avatar auto-detect + wardrobe integration             ║
   ╚═══════════════════════════════════════════════════════════════╝ */

/**
 * Inline Image Generation Extension for SillyTavern
 * 
 * Catches [IMG:GEN:{json}] tags in AI messages and generates images via configured API.
 * Supports OpenAI-compatible and Gemini-compatible (nano-banana) endpoints.
 */

const MODULE_NAME = 'inline_image_gen';

// Track messages currently being processed to prevent duplicate processing
const processingMessages = new Set();

// Log buffer for debugging
const logBuffer = [];
const MAX_LOG_ENTRIES = 200;

function iigLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const entry = `[${timestamp}] [${level}] ${message}`;
    
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
    }
    
    if (level === 'ERROR') {
        console.error('[IIG]', ...args);
    } else if (level === 'WARN') {
        console.warn('[IIG]', ...args);
    } else {
        console.log('[IIG]', ...args);
    }
}

function exportLogs() {
    const logsText = logBuffer.join('\n');
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iig-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Логи экспортированы', 'Генерация картинок');
}

// Default settings
const defaultSettings = Object.freeze({
    enabled: true,
    externalBlocks: false,
    imageContextEnabled: false,
    imageContextCount: 1,
    apiType: 'openai', // 'openai' | 'gemini' | 'naistera'
    endpoint: '',
    apiKey: '',
    model: '',
    size: '1024x1024',
    quality: 'standard',
    maxRetries: 0, // No auto-retry - user clicks error image to retry manually
    retryDelay: 1000,
    // Nano-banana specific
    sendCharAvatar: false,
    sendUserAvatar: false,
    userAvatarFile: '', // Selected user avatar filename from /User Avatars/
    aspectRatio: '1:1', // "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
    imageSize: '1K', // "1K", "2K", "4K"
    // Naistera specific
    naisteraAspectRatio: '1:1',
    naisteraModel: 'grok', // 'grok' | 'nano banana'
    naisteraSendCharAvatar: false,
    naisteraSendUserAvatar: false,
    naisteraVideoTest: false,
    naisteraVideoEveryN: 1,
    // Style reference
    styleRefBase64: '',
    styleRefName: '',
});

const MAX_CONTEXT_IMAGES = 3;
const MAX_GENERATION_REFERENCE_IMAGES = 5;

// Image model detection keywords (from your api_client.py)
const IMAGE_MODEL_KEYWORDS = [
    'dall-e', 'midjourney', 'mj', 'journey', 'stable-diffusion', 'sdxl', 'flux',
    'imagen', 'drawing', 'paint', 'image', 'seedream', 'hidream', 'dreamshaper',
    'ideogram', 'nano-banana', 'gpt-image', 'wanx', 'qwen'
];

// Video model keywords to exclude
const VIDEO_MODEL_KEYWORDS = [
    'sora', 'kling', 'jimeng', 'veo', 'pika', 'runway', 'luma',
    'video', 'gen-3', 'minimax', 'cogvideo', 'mochi', 'seedance',
    'vidu', 'wan-ai', 'hunyuan', 'hailuo'
];

// We'll parse tags manually since JSON can contain nested braces
// Tag format: [IMG:GEN:{...json...}] or <img src="[IMG:GEN:{...json...}]">

/**
 * Check if model ID is an image generation model
 */
function isImageModel(modelId) {
    const mid = modelId.toLowerCase();
    
    // Exclude video models
    for (const kw of VIDEO_MODEL_KEYWORDS) {
        if (mid.includes(kw)) return false;
    }
    
    // Exclude vision models
    if (mid.includes('vision') && mid.includes('preview')) return false;
    
    // Check for image model keywords
    for (const kw of IMAGE_MODEL_KEYWORDS) {
        if (mid.includes(kw)) return true;
    }
    
    return false;
}

/**
 * Check if model is Gemini/nano-banana type
 */
function isGeminiModel(modelId) {
    const mid = modelId.toLowerCase();
    return mid.includes('nano-banana');
}

const NAISTERA_MODELS = Object.freeze(['grok', 'nano banana']);
const DEFAULT_ENDPOINTS = Object.freeze({
    naistera: 'https://naistera.org',
});
const ENDPOINT_PLACEHOLDERS = Object.freeze({
    openai: 'https://api.openai.com',
    gemini: 'https://generativelanguage.googleapis.com',
    naistera: 'https://naistera.org',
});

function normalizeNaisteraModel(model) {
    const raw = String(model || '').trim().toLowerCase();
    if (!raw) return 'grok';
    if (raw === 'nano-banana') return 'nano banana';
    if (raw === 'nano-banana-pro') return 'nano banana';
    if (raw === 'nano-banana-2') return 'nano banana';
    if (raw === 'nano banana pro') return 'nano banana';
    if (raw === 'nano banana 2') return 'nano banana';
    if (NAISTERA_MODELS.includes(raw)) return raw;
    return 'grok';
}

function shouldUseNaisteraVideoTest(model) {
    const normalized = normalizeNaisteraModel(model);
    return normalized === 'grok' || normalized === 'nano banana';
}

function normalizeNaisteraVideoFrequency(value) {
    const numeric = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(numeric) || numeric < 1) return 1;
    return Math.min(numeric, 999);
}

function normalizeImageContextCount(value) {
    const numeric = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(numeric) || numeric < 1) return 1;
    return Math.min(numeric, MAX_CONTEXT_IMAGES);
}

function getAssistantMessageOrdinal(messageId) {
    const context = SillyTavern.getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    let ordinal = 0;
    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) {
            continue;
        }
        ordinal += 1;
        if (i === messageId) {
            return ordinal;
        }
    }
    return Math.max(1, messageId + 1);
}

function shouldTriggerNaisteraVideoForMessage(messageId, everyN) {
    const normalizedEveryN = normalizeNaisteraVideoFrequency(everyN);
    if (normalizedEveryN <= 1) return true;
    const ordinal = getAssistantMessageOrdinal(messageId);
    return ordinal % normalizedEveryN === 0;
}

function getEndpointPlaceholder(apiType) {
    return ENDPOINT_PLACEHOLDERS[apiType] || 'https://api.example.com';
}

function normalizeConfiguredEndpoint(apiType, endpoint) {
    const trimmed = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
        return apiType === 'naistera' ? DEFAULT_ENDPOINTS.naistera : '';
    }
    if (apiType === 'naistera') {
        return trimmed.replace(/\/api\/generate$/i, '');
    }
    return trimmed;
}

function shouldReplaceEndpointForApiType(apiType, endpoint) {
    const trimmed = String(endpoint || '').trim();
    if (!trimmed) return true;
    if (apiType !== 'naistera') return false;
    return /\/v1\/images\/generations\/?$/i.test(trimmed)
        || /\/v1\/models\/?$/i.test(trimmed)
        || /\/v1beta\/models\//i.test(trimmed);
}

function getEffectiveEndpoint(settings = getSettings()) {
    return normalizeConfiguredEndpoint(settings.apiType, settings.endpoint);
}

/**
 * Get extension settings
 */
function getSettings() {
    const context = SillyTavern.getContext();
    
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    
    // Ensure all default keys exist
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
            context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    
    return context.extensionSettings[MODULE_NAME];
}

/**
 * Save settings
 */
function saveSettings() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced();
}

function getMessageRenderText(message, settings = getSettings()) {
    if (!message) return '';
    if (settings.externalBlocks && message.extra?.display_text) {
        return message.extra.display_text;
    }
    return message.mes || '';
}

async function parseMessageImageTags(message, options = {}) {
    const settings = getSettings();
    const tags = [];

    const mainTags = await parseImageTags(message?.mes || '', options);
    tags.push(...mainTags.map(tag => ({ ...tag, sourceKey: 'mes' })));

    if (settings.externalBlocks && message?.extra?.extblocks) {
        const extTags = await parseImageTags(message.extra.extblocks, options);
        tags.push(...extTags.map(tag => ({ ...tag, sourceKey: 'extblocks' })));
    }

    return tags;
}

function replaceTagInMessageSource(message, tag, replacement) {
    if (!message || !tag) return;

    if (tag.sourceKey === 'extblocks') {
        if (!message.extra) message.extra = {};
        message.extra.extblocks = (message.extra.extblocks || '').replace(tag.fullMatch, replacement);

        const swipeId = message.swipe_id;
        if (swipeId !== undefined && message.swipe_info?.[swipeId]?.extra?.extblocks) {
            message.swipe_info[swipeId].extra.extblocks =
                message.swipe_info[swipeId].extra.extblocks.replace(tag.fullMatch, replacement);
        }

        if (message.extra.display_text) {
            message.extra.display_text = message.extra.display_text.replace(tag.fullMatch, replacement);
        }
        return;
    }

    message.mes = (message.mes || '').replace(tag.fullMatch, replacement);
    if (message.extra?.display_text) {
        message.extra.display_text = message.extra.display_text.replace(tag.fullMatch, replacement);
    }
}

function extractGeneratedImageUrlsFromText(text) {
    const urls = [];
    const seen = new Set();
    const rawText = String(text || '');

    const legacyMatches = Array.from(rawText.matchAll(/\[IMG:✓:([^\]]+)\]/g));
    for (let i = legacyMatches.length - 1; i >= 0; i--) {
        const src = String(legacyMatches[i][1] || '').trim();
        if (!src || seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
    }

    if (!rawText.includes('<img')) {
        return urls;
    }

    const template = document.createElement('template');
    template.innerHTML = rawText;
    const imageNodes = Array.from(
        template.content.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]')
    ).reverse();
    for (const node of imageNodes) {
        const src = String(node.getAttribute('src') || '').trim();
        if (
            !src ||
            src.startsWith('data:') ||
            src.includes('[IMG:') ||
            src.includes('[VID:') ||
            src.endsWith('/error.svg') ||
            seen.has(src)
        ) {
            continue;
        }
        seen.add(src);
        urls.push(src);
    }

    return urls;
}

function getPreviousGeneratedImageUrls(messageId, requestedCount) {
    const count = normalizeImageContextCount(requestedCount);
    if (!Number.isInteger(messageId) || messageId <= 0) {
        return [];
    }

    const settings = getSettings();
    const context = SillyTavern.getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const urls = [];
    const seen = new Set();

    for (let idx = messageId - 1; idx >= 0 && urls.length < count; idx--) {
        const message = chat[idx];
        if (!message || message.is_user || message.is_system) {
            continue;
        }

        const text = getMessageRenderText(message, settings);
        const messageUrls = extractGeneratedImageUrlsFromText(text);
        for (const url of messageUrls) {
            if (seen.has(url)) {
                continue;
            }
            seen.add(url);
            urls.push(url);
            if (urls.length >= count) {
                break;
            }
        }
    }

    return urls;
}

async function collectPreviousContextReferences(messageId, format, requestedCount) {
    const urls = getPreviousGeneratedImageUrls(messageId, requestedCount);
    if (urls.length === 0) {
        return [];
    }

    const convert = format === 'dataUrl' ? imageUrlToDataUrl : imageUrlToBase64;
    const converted = await Promise.all(urls.map((url) => convert(url)));
    return converted.filter(Boolean);
}

/**
 * Fetch models list from endpoint
 */
async function fetchModels() {
    const settings = getSettings();
    const endpoint = getEffectiveEndpoint(settings);
    
    if (!endpoint || !settings.apiKey) {
        console.warn('[IIG] Cannot fetch models: endpoint or API key not set');
        return [];
    }
    
    const url = `${endpoint}/v1/models`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const models = data.data || [];
        
        // Filter for image models only
        return models.filter(m => isImageModel(m.id)).map(m => m.id);
    } catch (error) {
        console.error('[IIG] Failed to fetch models:', error);
        toastr.error(`Ошибка загрузки моделей: ${error.message}`, 'Генерация картинок');
        return [];
    }
}

/**
 * Fetch list of user avatars from /User Avatars/ directory
 */
async function fetchUserAvatars() {
    try {
        const context = SillyTavern.getContext();
        const response = await fetch('/api/avatars/get', {
            method: 'POST',
            headers: context.getRequestHeaders(),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json(); // Returns array of filenames
    } catch (error) {
        console.error('[IIG] Failed to fetch user avatars:', error);
        return [];
    }
}

/**
 * Convert image URL to base64
 */
async function imageUrlToBase64(url) {
    try {
        const blob = await fetchImageBlob(url);
        if (!blob) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Remove data URL prefix to get pure base64
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[IIG] Failed to convert image to base64:', error);
        return null;
    }
}

/**
 * Convert image URL to data URL (data:image/...;base64,...)
 */
async function imageUrlToDataUrl(url) {
    try {
        const blob = await fetchImageBlob(url);
        if (!blob) {
            return null;
        }

        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[IIG] Failed to convert image to data URL:', error);
        return null;
    }
}

async function fetchImageBlob(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            iigLog('WARN', `Skipping context reference fetch: url=${url} status=${response.status}`);
            return null;
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            iigLog(
                'WARN',
                `Skipping context reference with non-image content-type: url=${url} contentType=${contentType || '(empty)'}`
            );
            return null;
        }

        const blob = await response.blob();
        const blobType = String(blob.type || contentType || '').toLowerCase();
        if (!blobType.startsWith('image/')) {
            iigLog(
                'WARN',
                `Skipping context reference with non-image blob type: url=${url} blobType=${blobType || '(empty)'}`
            );
            return null;
        }
        return blob;
    } catch (error) {
        iigLog('WARN', `Skipping context reference fetch failure: url=${url} err=${error?.message || error}`);
        return null;
    }
}

/**
 * Save base64 image to file via SillyTavern API
 * @param {string} dataUrl - Data URL (data:image/png;base64,...)
 * @returns {Promise<string>} - Relative path to saved file
 */
const IIG_UPLOAD_FORMAT_MAP = Object.freeze({
    'jpeg': 'jpg',
    'jpg': 'jpg',
    'pjpeg': 'jpg',
    'jfif': 'jpg',
    'png': 'png',
    'x-png': 'png',
    'webp': 'webp',
    'gif': 'gif',
});

const IIG_UPLOAD_ALLOWED_FORMATS = new Set(['jpg', 'png', 'webp', 'gif']);

function parseImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') {
        throw new Error(`Invalid data URL type: ${typeof dataUrl}`);
    }
    if (!dataUrl.startsWith('data:')) {
        throw new Error('Invalid data URL prefix (expected data:)');
    }

    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx <= 5) {
        throw new Error('Invalid data URL format (missing comma)');
    }

    const meta = dataUrl.slice(5, commaIdx).trim();
    const base64Data = dataUrl.slice(commaIdx + 1).trim();
    const metaParts = meta.split(';').map(s => s.trim()).filter(Boolean);
    const mimeType = (metaParts[0] || '').toLowerCase();
    const hasBase64 = metaParts.some(p => p.toLowerCase() === 'base64');

    if (!mimeType.startsWith('image/')) {
        throw new Error(`Invalid data URL mime type: ${mimeType || '(empty)'}`);
    }
    if (!hasBase64) {
        throw new Error('Invalid data URL encoding (base64 flag missing)');
    }
    if (!base64Data) {
        throw new Error('Invalid data URL payload (empty base64)');
    }

    const subtype = mimeType.slice('image/'.length).toLowerCase();
    const normalizedFormat = IIG_UPLOAD_FORMAT_MAP[subtype] || subtype;

    return {
        mimeType,
        subtype,
        normalizedFormat,
        base64Data,
    };
}

async function convertDataUrlToPng(dataUrl) {
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height) {
                reject(new Error('Image decode failed (no dimensions)'));
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas 2D context unavailable'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Failed to decode data URL image'));
        img.src = dataUrl;
    });
}

async function saveImageToFile(dataUrl, debugMeta = {}) {
    const context = SillyTavern.getContext();

    let parsed;
    try {
        parsed = parseImageDataUrl(dataUrl);
    } catch (error) {
        iigLog(
            'ERROR',
            `saveImageToFile parse failed: ${error.message}; debug=${JSON.stringify(debugMeta)}; prefix=${String(dataUrl).slice(0, 120)}`
        );
        throw error;
    }

    if (!IIG_UPLOAD_ALLOWED_FORMATS.has(parsed.normalizedFormat)) {
        iigLog(
            'WARN',
            `Unsupported upload format "${parsed.subtype}" (mime=${parsed.mimeType}); converting to PNG; debug=${JSON.stringify(debugMeta)}`
        );
        const converted = await convertDataUrlToPng(dataUrl);
        parsed = parseImageDataUrl(converted);
    }

    const format = parsed.normalizedFormat;
    const base64Data = parsed.base64Data;
    iigLog(
        'INFO',
        `Uploading image: mime=${parsed.mimeType} subtype=${parsed.subtype} format=${format} b64len=${base64Data.length} debug=${JSON.stringify(debugMeta)}`
    );
    
    // Get character name for subfolder
    let charName = 'generated';
    if (context.characterId !== undefined && context.characters?.[context.characterId]) {
        charName = context.characters[context.characterId].name || 'generated';
    }
    
    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `iig_${timestamp}`;
    
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64Data,
            format: format,
            ch_name: charName,
            filename: filename
        })
    });
    
    if (!response.ok) {
        const raw = await response.text().catch(() => '');
        let parsedError = {};
        try {
            parsedError = raw ? JSON.parse(raw) : {};
        } catch (_e) {
            parsedError = {};
        }
        const errText = parsedError?.error || parsedError?.detail || raw || `Upload failed: ${response.status}`;
        iigLog(
            'ERROR',
            `Upload failed status=${response.status} format=${format} mime=${parsed.mimeType} debug=${JSON.stringify(debugMeta)} response=${String(errText).slice(0, 400)}`
        );
        throw new Error(errText);
    }
    
    const result = await response.json();
    console.log('[IIG] Image saved to:', result.path);
    return result.path;
}

async function saveNaisteraMediaToFile(dataUrl, mediaKind = 'video', debugMeta = {}) {
    if (mediaKind !== 'video') {
        throw new Error(`Unsupported mediaKind for file upload: ${mediaKind}`);
    }

    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:video/mp4;base64,')) {
        throw new Error('Only data:video/mp4;base64 URLs are supported');
    }

    const context = SillyTavern.getContext();
    const base64Data = dataUrl.slice('data:video/mp4;base64,'.length).trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `iig_video_${timestamp}.mp4`;

    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            name: fileName,
            data: base64Data,
        })
    });

    if (!response.ok) {
        const raw = await response.text().catch(() => '');
        iigLog(
            'ERROR',
            `ST media upload failed status=${response.status} kind=${mediaKind} debug=${JSON.stringify(debugMeta)} response=${String(raw).slice(0, 400)}`
        );
        throw new Error(raw || `Media upload failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result?.path) {
        throw new Error('No path in media upload response');
    }
    return result.path;
}

/**
 * Get character avatar as base64
 */
async function getCharacterAvatarBase64() {
    try {
        const context = SillyTavern.getContext();
        
        console.log('[IIG] Getting character avatar, characterId:', context.characterId);
        
        if (context.characterId === undefined || context.characterId === null) {
            console.log('[IIG] No character selected');
            return null;
        }
        
        // Try context method first
        if (typeof context.getCharacterAvatar === 'function') {
            const avatarUrl = context.getCharacterAvatar(context.characterId);
            console.log('[IIG] getCharacterAvatar returned:', avatarUrl);
            if (avatarUrl) {
                return await imageUrlToBase64(avatarUrl);
            }
        }
        
        // Fallback: try to get from characters array
        const character = context.characters?.[context.characterId];
        console.log('[IIG] Character from array:', character?.name, 'avatar:', character?.avatar);
        if (character?.avatar) {
            const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
            console.log('[IIG] Found character avatar:', avatarUrl);
            return await imageUrlToBase64(avatarUrl);
        }
        
        console.log('[IIG] Could not get character avatar');
        return null;
    } catch (error) {
        console.error('[IIG] Error getting character avatar:', error);
        return null;
    }
}

/**
 * Get character avatar as data URL (for Naistera references)
 */
async function getCharacterAvatarDataUrl() {
    try {
        const context = SillyTavern.getContext();

        if (context.characterId === undefined || context.characterId === null) {
            return null;
        }

        if (typeof context.getCharacterAvatar === 'function') {
            const avatarUrl = context.getCharacterAvatar(context.characterId);
            if (avatarUrl) {
                return await imageUrlToDataUrl(avatarUrl);
            }
        }

        const character = context.characters?.[context.characterId];
        if (character?.avatar) {
            const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
            return await imageUrlToDataUrl(avatarUrl);
        }

        return null;
    } catch (error) {
        console.error('[IIG] Error getting character avatar data URL:', error);
        return null;
    }
}

/**
 * Get user avatar as base64 (full resolution, not thumbnail)
 * Auto-detects current persona avatar, falls back to manual setting.
 */
async function getUserAvatarBase64() {
    try {
        const context = SillyTavern.getContext();
        const settings = getSettings();

        // 1. Auto-detect from current persona (user_avatar is the active persona filename)
        const currentAvatar = context.user_avatar;
        if (currentAvatar) {
            const avatarUrl = `/User Avatars/${encodeURIComponent(currentAvatar)}`;
            iigLog('INFO', `Using current persona avatar: ${currentAvatar}`);
            const b64 = await imageUrlToBase64(avatarUrl);
            if (b64) return b64;
            iigLog('WARN', `Failed to load persona avatar: ${currentAvatar}, trying fallback`);
        }

        // 2. Fallback: try to find avatar from DOM (user message avatar img)
        const userMsgAvatar = document.querySelector('#chat .mes[is_user="true"] .avatar img');
        if (userMsgAvatar?.src) {
            iigLog('INFO', 'Using user avatar from DOM');
            const b64 = await imageUrlToBase64(userMsgAvatar.src);
            if (b64) return b64;
        }

        // 3. Fallback: manual setting
        if (settings.userAvatarFile) {
            const avatarUrl = `/User Avatars/${encodeURIComponent(settings.userAvatarFile)}`;
            iigLog('INFO', `Using manually selected user avatar: ${settings.userAvatarFile}`);
            return await imageUrlToBase64(avatarUrl);
        }

        iigLog('WARN', 'No user avatar found (no persona, no DOM, no manual setting)');
        return null;
    } catch (error) {
        console.error('[IIG] Error getting user avatar:', error);
        return null;
    }
}

/**
 * Generate image via OpenAI-compatible endpoint
 */
async function generateImageOpenAI(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const url = `${settings.endpoint.replace(/\/$/, '')}/v1/images/generations`;
    
    // Combine style and prompt (skip text style when style ref image is active)
    const fullPrompt = (style && !settings.styleRefBase64) ? `[Style: ${style}] ${prompt}` : prompt;
    
    // Map aspect ratio to size if provided in tag
    let size = settings.size;
    if (options.aspectRatio) {
        if (options.aspectRatio === '16:9') size = '1792x1024';
        else if (options.aspectRatio === '9:16') size = '1024x1792';
        else if (options.aspectRatio === '1:1') size = '1024x1024';
    }
    
    const body = {
        model: settings.model,
        prompt: fullPrompt,
        n: 1,
        size: size,
        quality: options.quality || settings.quality,
        response_format: 'b64_json'
    };
    
    // Add reference image if supported (for models like GPT-Image-1, FLUX)
    if (referenceImages.length > 0) {
        body.image = `data:image/png;base64,${referenceImages[0]}`;
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }
    
    const result = await response.json();
    
    // Parse response - standard OpenAI format
    const dataList = result.data || [];
    if (dataList.length === 0) {
        if (result.url) return result.url;
        throw new Error('No image data in response');
    }
    
    const imageObj = dataList[0];
    const imageData = imageObj.b64_json || imageObj.url;
    
    // Return as data URL if b64_json
    if (imageObj.b64_json) {
        return `data:image/png;base64,${imageObj.b64_json}`;
    }
    
    return imageData;
}

// Valid aspect ratios for Gemini/nano-banana
const VALID_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
// Valid image sizes for Gemini/nano-banana
const VALID_IMAGE_SIZES = ['1K', '2K', '4K'];

/**
 * Generate image via Gemini-compatible endpoint (nano-banana)
 */
async function generateImageGemini(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const model = settings.model;
    const url = `${settings.endpoint.replace(/\/$/, '')}/v1beta/models/${model}:generateContent`;
    
    // Determine aspect ratio: tag option > settings, with validation
    let aspectRatio = options.aspectRatio || settings.aspectRatio || '1:1';
    if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
        iigLog('WARN', `Invalid aspect_ratio "${aspectRatio}", falling back to settings or default`);
        aspectRatio = VALID_ASPECT_RATIOS.includes(settings.aspectRatio) ? settings.aspectRatio : '1:1';
    }
    
    // Determine image size: tag option > settings, with validation
    let imageSize = options.imageSize || settings.imageSize || '1K';
    if (!VALID_IMAGE_SIZES.includes(imageSize)) {
        iigLog('WARN', `Invalid image_size "${imageSize}", falling back to settings or default`);
        imageSize = VALID_IMAGE_SIZES.includes(settings.imageSize) ? settings.imageSize : '1K';
    }
    
    iigLog('INFO', `Using aspect ratio: ${aspectRatio}, image size: ${imageSize}`);
    
    // Build parts array — each reference gets a label so Gemini knows what it is
    const parts = [];
    const refLabels = options.refLabels || [];
    
    // Add reference images with explicit text labels
    for (let i = 0; i < Math.min(referenceImages.length, MAX_GENERATION_REFERENCE_IMAGES); i++) {
        const label = refLabels[i] || 'reference';
        const labelMap = {
            'char_face': '⬇️ CHARACTER FACE REFERENCE — copy this face exactly:',
            'user_face': '⬇️ USER FACE REFERENCE — copy this face exactly:',
            'char_outfit': '⬇️ CHARACTER OUTFIT REFERENCE — copy this clothing:',
            'user_outfit': '⬇️ USER OUTFIT REFERENCE — copy this clothing:',
            'context': '⬇️ SCENE CONTEXT (for style/mood consistency):',
            'style_ref': '⬇️ STYLE REFERENCE — you MUST draw the output image in the EXACT SAME art style as this image. Copy the rendering technique, line work, shading, coloring, and visual feel precisely:',
        };
        // Add text label before each image
        parts.push({ text: labelMap[label] || '⬇️ REFERENCE IMAGE:' });
        parts.push({
            inlineData: {
                mimeType: 'image/png',
                data: referenceImages[i]
            }
        });
    }
    
    // Build detailed instruction based on what references we have
    const hasFaces = refLabels.some(l => l.endsWith('_face'));
    const hasOutfits = refLabels.some(l => l.endsWith('_outfit'));
    const hasContext = refLabels.includes('context');
    const hasStyleRef = refLabels.includes('style_ref');
    
    let refInstruction = '';
    if (referenceImages.length > 0) {
        const rules = [];
        if (hasStyleRef) {
            rules.push('STYLE REFERENCE (HIGHEST PRIORITY): A style reference image is provided. The ENTIRE generated image MUST be drawn in the EXACT SAME art style as the style reference — same rendering technique, line work, shading, color palette, texture, and overall visual feel. If the style reference is anime/manga, the output MUST be anime/manga. If it is watercolor, the output MUST be watercolor. Do NOT copy characters, objects, or scenes from it — only replicate the artistic style precisely.');
        }
        if (hasFaces) {
            rules.push('FACE CONSISTENCY: You MUST precisely replicate the facial features (face structure, eye color/shape, hair color/style/length, skin tone, facial hair, age) from the FACE REFERENCE images. These faces must be recognizable as the same people across all generated images. This is the HIGHEST priority.');
        }
        if (hasOutfits) {
            rules.push('OUTFIT ACCURACY: The characters must wear EXACTLY the clothing shown in the OUTFIT REFERENCE images — same garments, colors, fabrics, accessories. Do not invent or change any clothing details.');
        }
        if (hasContext) {
            rules.push('STYLE CONSISTENCY: Match the art style, lighting, color palette, and rendering quality of the CONTEXT reference images. The generated image should look like it belongs to the same series.');
        }
        if (!hasStyleRef && !hasContext && style) {
            rules.push(`STYLE: Generate in "${style}" style consistently. Do not mix styles.`);
        }
        refInstruction = `[STRICT IMAGE GENERATION RULES]\n${rules.join('\n')}\n[END RULES]\n\n`;
    }
    
    // Add prompt with style and instruction
    // When style ref image is present, skip text style to avoid conflicting instructions
    let fullPrompt = (style && !hasStyleRef) ? `[Style: ${style}] ${prompt}` : prompt;
    fullPrompt = `${refInstruction}${fullPrompt}`;
    
    parts.push({ text: fullPrompt });
    
    const labelSummary = refLabels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {});
    console.log(`[IIG] Gemini request: ${referenceImages.length} refs (${JSON.stringify(labelSummary)}) + prompt (${fullPrompt.length} chars)`);
    
    const body = {
        contents: [{
            role: 'user',
            parts: parts
        }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: aspectRatio,
                imageSize: imageSize
            }
        }
    };
    
    // Log full request config for debugging 400 errors
    iigLog('INFO', `Gemini request config: model=${model}, aspectRatio=${aspectRatio}, imageSize=${imageSize}, promptLength=${fullPrompt.length}, refImages=${referenceImages.length}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }
    
    const result = await response.json();
    
    // Parse Gemini response
    const candidates = result.candidates || [];
    if (candidates.length === 0) {
        throw new Error('No candidates in response');
    }
    
    const responseParts = candidates[0].content?.parts || [];
    
    for (const part of responseParts) {
        // Check both camelCase and snake_case variants
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        if (part.inline_data) {
            return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
        }
    }
    
    throw new Error('No image found in Gemini response');
}

/**
 * Get user avatar as data URL (for Naistera references)
 * Auto-detects current persona avatar, falls back to manual setting.
 */
async function getUserAvatarDataUrl() {
    try {
        const context = SillyTavern.getContext();
        const settings = getSettings();

        // 1. Auto-detect from current persona
        const currentAvatar = context.user_avatar;
        if (currentAvatar) {
            const avatarUrl = `/User Avatars/${encodeURIComponent(currentAvatar)}`;
            const dataUrl = await imageUrlToDataUrl(avatarUrl);
            if (dataUrl) return dataUrl;
        }

        // 2. Fallback: DOM
        const userMsgAvatar = document.querySelector('#chat .mes[is_user="true"] .avatar img');
        if (userMsgAvatar?.src) {
            const dataUrl = await imageUrlToDataUrl(userMsgAvatar.src);
            if (dataUrl) return dataUrl;
        }

        // 3. Fallback: manual setting
        if (settings.userAvatarFile) {
            const avatarUrl = `/User Avatars/${encodeURIComponent(settings.userAvatarFile)}`;
            return await imageUrlToDataUrl(avatarUrl);
        }

        return null;
    } catch (error) {
        console.error('[IIG] Error getting user avatar data URL:', error);
        return null;
    }
}

/**
 * Generate image via Naistera custom endpoint
 * POST {endpoint}/api/generate
 * Auth: Authorization: Bearer <token>
 * Response: { data_url, content_type, media_kind?, poster_data_url? }
 */
async function generateImageNaistera(prompt, style, options = {}) {
    const settings = getSettings();
    const endpoint = getEffectiveEndpoint(settings);
    const url = endpoint.endsWith('/api/generate') ? endpoint : `${endpoint}/api/generate`;

    // Skip text style when style ref image is active
    const fullPrompt = (style && !settings.styleRefBase64) ? `[Style: ${style}] ${prompt}` : prompt;

    const aspectRatio = options.aspectRatio || settings.naisteraAspectRatio || '1:1';
    const model = normalizeNaisteraModel(options.model || settings.naisteraModel || 'grok');
    const preset = options.preset || null;
    const referenceImages = options.referenceImages || [];
    const wantsVideoTest = Boolean(options.videoTestMode);
    const videoEveryN = normalizeNaisteraVideoFrequency(options.videoEveryN ?? settings.naisteraVideoEveryN);

    const body = {
        prompt: fullPrompt,
        aspect_ratio: aspectRatio,
        model,
    };
    if (preset) body.preset = preset;
    if (referenceImages.length > 0) {
        body.reference_images = referenceImages.slice(0, MAX_GENERATION_REFERENCE_IMAGES);
    }
    if (wantsVideoTest) {
        body.video_test_mode = true;
        body.video_test_every_n_messages = videoEveryN;
    }

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    } catch (error) {
        const pageOrigin = window.location.origin;
        let endpointOrigin = endpoint;
        try {
            endpointOrigin = new URL(url, window.location.href).origin;
        } catch (parseErr) {
            console.warn('[IIG] Failed to parse Naistera endpoint origin:', parseErr);
        }
        const rawMessage = String(error?.message || '').trim() || 'Failed to fetch';
        throw new Error(
            `Network/CORS error while requesting ${endpointOrigin} from ${pageOrigin}. `
            + `The browser blocked access to the response before the API could return JSON. `
            + `Original error: ${rawMessage}`
        );
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error (${response.status}): ${text}`);
    }

    const result = await response.json();
    if (!result?.data_url) {
        throw new Error('No data_url in response');
    }
    if (result.media_kind === 'video') {
        return {
            kind: 'video',
            dataUrl: result.data_url,
            posterDataUrl: result.poster_data_url || '',
            contentType: result.content_type || 'video/mp4',
        };
    }
    return result.data_url;
}

/**
 * Validate settings before generation
 */
function validateSettings() {
    const settings = getSettings();
    const errors = [];
    
    if (!settings.endpoint) {
        if (settings.apiType !== 'naistera') {
            errors.push('URL эндпоинта не настроен');
        }
    }
    if (!settings.apiKey) {
        errors.push('API ключ не настроен');
    }
    if (settings.apiType !== 'naistera' && !settings.model) {
        errors.push('Модель не выбрана');
    }
    if (settings.apiType === 'naistera') {
        const m = normalizeNaisteraModel(settings.naisteraModel);
        if (!NAISTERA_MODELS.includes(m)) {
            errors.push('Для Naistera выберите модель: grok / nano banana');
        }
    }
    
    if (errors.length > 0) {
        throw new Error(`Ошибка настроек: ${errors.join(', ')}`);
    }
}

/**
 * Sanitize text for safe HTML display
 */
function sanitizeForHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function isGeneratedVideoResult(value) {
    return Boolean(value) && typeof value === 'object' && value.kind === 'video' && typeof value.dataUrl === 'string';
}

function createGeneratedMediaElement(result, tag) {
    if (isGeneratedVideoResult(result)) {
        const video = document.createElement('video');
        video.className = 'iig-generated-video';
        video.src = result.dataUrl;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.title = `Style: ${tag.style}\nPrompt: ${tag.prompt}`;
        if (result.posterDataUrl) {
            video.poster = result.posterDataUrl;
        }
        return video;
    }

    const img = document.createElement('img');
    img.className = 'iig-generated-image';
    img.src = result;
    img.alt = tag.prompt;
    img.title = `Style: ${tag.style}\nPrompt: ${tag.prompt}`;
    return img;
}

function buildPersistedVideoTag(templateHtml, persistedSrc, posterSrc = '') {
    let html = String(templateHtml || '').trim()
        .replace(/^<(?:img|video)\b/i, '<video controls autoplay loop muted playsinline')
        .replace(/<\/video>\s*$/i, '')
        .replace(/\/?>\s*$/i, '')
        .replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${persistedSrc}"`);
    html = html.replace(/\s+poster\s*=\s*(['"])[\s\S]*?\1/i, '');
    if (posterSrc) {
        html = html.replace(/^<video\b/i, `<video poster="${sanitizeForHtml(posterSrc)}"`);
    }
    return `${html}></video>`;
}

/**
 * Generate image with retry logic
 * @param {string} prompt - Image description
 * @param {string} style - Style tag
 * @param {function} onStatusUpdate - Status callback
 * @param {object} options - Additional options (aspectRatio, quality)
 */
async function generateImageWithRetry(prompt, style, onStatusUpdate, options = {}) {
    // Validate settings first
    validateSettings();
    
    const settings = getSettings();
    const maxRetries = settings.maxRetries;
    const baseDelay = settings.retryDelay;
    
    // Collect reference images (provider-specific)
    const referenceImages = [];
    const referenceDataUrls = [];

    // For Gemini: collect with labels for smart instruction
    const refLabels = []; // parallel array: 'char_face', 'user_face', 'char_outfit', 'user_outfit', 'context'

    // Gemini/nano-banana references: PRIORITY ORDER — faces first, outfits second, context last
    if (settings.apiType === 'gemini' || isGeminiModel(settings.model)) {
        // 0. Style reference (STYLE ONLY — highest visual priority)
        if (settings.styleRefBase64) {
            referenceImages.push(settings.styleRefBase64);
            refLabels.push('style_ref');
            iigLog('INFO', 'Style reference added for Gemini');
        }
        // 1. Character avatar (FACE — highest priority)
        if (settings.sendCharAvatar) {
            const charAvatar = await getCharacterAvatarBase64();
            if (charAvatar) { referenceImages.push(charAvatar); refLabels.push('char_face'); }
        }
        // 2. User avatar (FACE)
        if (settings.sendUserAvatar) {
            const userAvatar = await getUserAvatarBase64();
            if (userAvatar) { referenceImages.push(userAvatar); refLabels.push('user_face'); }
        }
        // 3. Wardrobe outfits (APPEARANCE — before context!)
        if (window.sillyWardrobe?.isReady()) {
            const botB64 = window.sillyWardrobe.getActiveOutfitBase64('bot');
            const userB64 = window.sillyWardrobe.getActiveOutfitBase64('user');
            if (botB64) { referenceImages.push(botB64); refLabels.push('char_outfit'); }
            if (userB64) { referenceImages.push(userB64); refLabels.push('user_outfit'); }
            if (botB64 || userB64) iigLog('INFO', `Wardrobe refs added: bot=${!!botB64}, user=${!!userB64}`);
        }
        // 4. Context (previous generated images — LOWEST priority, fills remaining slots)
        if (settings.imageContextEnabled) {
            const contextCount = normalizeImageContextCount(settings.imageContextCount);
            const contextRefs = await collectPreviousContextReferences(options.messageId, 'base64', contextCount);
            for (const cr of contextRefs) { referenceImages.push(cr); refLabels.push('context'); }
        }
    }

    // Naistera references: data URLs (server uploads to Grok)
    if (settings.apiType === 'naistera') {
        if (settings.styleRefBase64) {
            referenceDataUrls.push(`data:image/png;base64,${settings.styleRefBase64}`);
            iigLog('INFO', 'Style reference added for Naistera');
        }
        if (settings.naisteraSendCharAvatar) {
            const d = await getCharacterAvatarDataUrl();
            if (d) referenceDataUrls.push(d);
        }
        if (settings.naisteraSendUserAvatar) {
            const d = await getUserAvatarDataUrl();
            if (d) referenceDataUrls.push(d);
        }
        if (settings.imageContextEnabled) {
            const contextCount = normalizeImageContextCount(settings.imageContextCount);
            const contextRefs = await collectPreviousContextReferences(options.messageId, 'dataUrl', contextCount);
            referenceDataUrls.push(...contextRefs);
        }
        if (window.sillyWardrobe?.isReady()) {
            const botB64 = window.sillyWardrobe.getActiveOutfitBase64('bot');
            const userB64 = window.sillyWardrobe.getActiveOutfitBase64('user');
            if (botB64) referenceDataUrls.push(`data:image/png;base64,${botB64}`);
            if (userB64) referenceDataUrls.push(`data:image/png;base64,${userB64}`);
        }
    }

    // OpenAI: same old order (only slot 0 matters anyway)
    if (settings.apiType !== 'gemini' && !isGeminiModel(settings.model) && settings.apiType !== 'naistera') {
        if (settings.styleRefBase64) {
            referenceImages.push(settings.styleRefBase64);
            iigLog('INFO', 'Style reference added for OpenAI');
        }
        if (window.sillyWardrobe?.isReady()) {
            const botB64 = window.sillyWardrobe.getActiveOutfitBase64('bot');
            const userB64 = window.sillyWardrobe.getActiveOutfitBase64('user');
            if (botB64) referenceImages.push(botB64);
            if (userB64) referenceImages.push(userB64);
        }
    }

    if (referenceImages.length > MAX_GENERATION_REFERENCE_IMAGES) {
        referenceImages.length = MAX_GENERATION_REFERENCE_IMAGES;
        refLabels.length = MAX_GENERATION_REFERENCE_IMAGES;
    }
    if (referenceDataUrls.length > MAX_GENERATION_REFERENCE_IMAGES) {
        referenceDataUrls.length = MAX_GENERATION_REFERENCE_IMAGES;
    }

    const enableVideoTest = settings.apiType === 'naistera'
        && settings.naisteraVideoTest
        && shouldUseNaisteraVideoTest(options.model || settings.naisteraModel)
        && shouldTriggerNaisteraVideoForMessage(options.messageId, settings.naisteraVideoEveryN);
    
    // ── Inject wardrobe outfit descriptions into prompt ──
    if (window.sillyWardrobe?.isReady()) {
        const botData = window.sillyWardrobe.getActiveOutfitData('bot');
        const userData = window.sillyWardrobe.getActiveOutfitData('user');
        const parts = [];
        if (botData?.description) parts.push(`[Character's current outfit: ${botData.description}]`);
        if (userData?.description) parts.push(`[User's current outfit: ${userData.description}]`);
        if (parts.length > 0) {
            prompt = `${parts.join(' ')}\n${prompt}`;
            iigLog('INFO', `Wardrobe descriptions injected: ${parts.join(', ')}`);
        }
    }

    // ── Inject style reference instruction into prompt (for non-Gemini APIs) ──
    if (settings.styleRefBase64 && settings.apiType !== 'gemini' && !isGeminiModel(settings.model)) {
        prompt = `[STYLE REFERENCE: A reference image is attached for art style ONLY. Copy ONLY the art style, color palette, rendering technique, and visual texture. Do NOT take any characters, objects, scenes, or content from it.]\n${prompt}`;
        iigLog('INFO', 'Style reference instruction prepended to prompt');
    }

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            onStatusUpdate?.(`Генерация${attempt > 0 ? ` (повтор ${attempt}/${maxRetries})` : ''}...`);
            let generated;
            // Choose API based on type or model
            if (settings.apiType === 'naistera') {
                generated = await generateImageNaistera(prompt, style, {
                    ...options,
                    referenceImages: referenceDataUrls,
                    videoTestMode: enableVideoTest,
                    videoEveryN: settings.naisteraVideoEveryN,
                });
            } else if (settings.apiType === 'gemini' || isGeminiModel(settings.model)) {
                generated = await generateImageGemini(prompt, style, referenceImages, { ...options, refLabels });
            } else {
                generated = await generateImageOpenAI(prompt, style, referenceImages, options);
            }

            if (generated && typeof generated === 'object' && generated.kind === 'video') {
                iigLog(
                    'INFO',
                    `Generation result: apiType=${settings.apiType} kind=video mime=${generated.contentType} poster=${generated.posterDataUrl ? 'yes' : 'no'}`
                );
            } else if (typeof generated === 'string' && generated.startsWith('data:')) {
                try {
                    const parsed = parseImageDataUrl(generated);
                    iigLog(
                        'INFO',
                        `Generation result: apiType=${settings.apiType} mime=${parsed.mimeType} subtype=${parsed.subtype} b64len=${parsed.base64Data.length}`
                    );
                } catch (parseErr) {
                    iigLog(
                        'WARN',
                        `Generation result has unparsable data URL: ${parseErr.message}; prefix=${generated.slice(0, 120)}`
                    );
                }
            } else {
                iigLog(
                    'INFO',
                    `Generation result is non-data-url: apiType=${settings.apiType} value=${String(generated).slice(0, 160)}`
                );
            }
            return generated;
        } catch (error) {
            lastError = error;
            console.error(`[IIG] Generation attempt ${attempt + 1} failed:`, error);
            
            // Check if retryable
            const isRetryable = error.message?.includes('429') ||
                               error.message?.includes('503') ||
                               error.message?.includes('502') ||
                               error.message?.includes('504') ||
                               error.message?.includes('timeout') ||
                               error.message?.includes('network');
            
            if (!isRetryable || attempt === maxRetries) {
                break;
            }
            
            const delay = baseDelay * Math.pow(2, attempt);
            onStatusUpdate?.(`Повтор через ${delay / 1000}с...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

/**
 * Check if a file exists on the server
 */
async function checkFileExists(path) {
    try {
        const response = await fetch(path, { method: 'HEAD' });
        return response.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Parse image generation tags from message text
 * Supports two formats:
 * 1. NEW: <img|video data-iig-instruction='{"style":"...","prompt":"..."}' src="...">
 * 2. LEGACY: [IMG:GEN:{"style":"...","prompt":"..."}]
 * 
 * @param {string} text - Message text
 * @param {object} options - Options
 * @param {boolean} options.checkExistence - Check if image files exist (for hallucination detection)
 * @param {boolean} options.forceAll - Include all instruction tags even with valid paths (for regeneration)
 */
async function parseImageTags(text, options = {}) {
    const { checkExistence = false, forceAll = false } = options;
    const tags = [];
    
    // === NEW FORMAT: <img|video data-iig-instruction="{...}" src="..."> ===
    // LLM often generates broken HTML with unescaped quotes, so we parse manually
    const imgTagMarker = 'data-iig-instruction=';
    let searchPos = 0;
    
    while (true) {
        const markerPos = text.indexOf(imgTagMarker, searchPos);
        if (markerPos === -1) break;
        
        // Find the start of the media tag.
        const imgStart = text.lastIndexOf('<img', markerPos);
        const videoStart = text.lastIndexOf('<video', markerPos);
        const mediaStart = Math.max(imgStart, videoStart);
        const isVideoTag = mediaStart === videoStart && videoStart !== -1;
        const tagName = isVideoTag ? 'video' : 'img';
        if (mediaStart === -1 || markerPos - mediaStart > 800) {
            searchPos = markerPos + 1;
            continue;
        }
        
        // Find the JSON start (first { after the marker)
        const afterMarker = markerPos + imgTagMarker.length;
        let jsonStart = text.indexOf('{', afterMarker);
        if (jsonStart === -1 || jsonStart > afterMarker + 10) {
            searchPos = markerPos + 1;
            continue;
        }
        
        // Find matching closing brace using brace counting
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }
        }
        
        if (jsonEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }
        
        // Find the end of the media tag.
        let mediaEnd = -1;
        if (isVideoTag) {
            mediaEnd = text.indexOf('</video>', jsonEnd);
            if (mediaEnd !== -1) {
                mediaEnd += '</video>'.length;
            }
        } else {
            mediaEnd = text.indexOf('>', jsonEnd);
            if (mediaEnd !== -1) {
                mediaEnd += 1;
            }
        }
        if (mediaEnd === -1) {
            searchPos = markerPos + 1;
            continue;
        }

        const fullImgTag = text.substring(mediaStart, mediaEnd);
        const instructionJson = text.substring(jsonStart, jsonEnd);
        
        // Check if src needs generation
        const srcMatch = fullImgTag.match(/src\s*=\s*["']?([^"'\s>]+)/i);
        const srcValue = srcMatch ? srcMatch[1] : '';
        
        // Determine if this needs generation
        let needsGeneration = false;
        const hasMarker = srcValue.includes('[IMG:GEN]') || srcValue.includes('[IMG:');
        const hasErrorImage = srcValue.includes('error.svg'); // Our error placeholder - NO auto-retry
        const hasPath = srcValue && srcValue.startsWith('/') && srcValue.length > 5;
        
        // Skip error images - user must click to retry manually (prevents conflict on swipe)
        if (hasErrorImage && !forceAll) {
            iigLog('INFO', `Skipping error image (click to retry): ${srcValue.substring(0, 50)}`);
            searchPos = mediaEnd;
            continue;
        }
        
        if (forceAll) {
            // Regeneration mode: include all tags with instruction (user-triggered)
            needsGeneration = true;
            iigLog('INFO', `Force regeneration mode: including ${srcValue.substring(0, 30)}`);
        } else if (hasMarker || !srcValue) {
            // Explicit marker or empty src = needs generation
            needsGeneration = true;
        } else if (hasPath && checkExistence) {
            // Has a path - check if file actually exists
            const exists = await checkFileExists(srcValue);
            if (!exists) {
                // File doesn't exist = LLM hallucinated the path
                iigLog('WARN', `File does not exist (LLM hallucination?): ${srcValue}`);
                needsGeneration = true;
            } else {
                iigLog('INFO', `Skipping existing image: ${srcValue.substring(0, 50)}`);
            }
        } else if (hasPath) {
            // Has path but not checking existence - skip
            iigLog('INFO', `Skipping path (no existence check): ${srcValue.substring(0, 50)}`);
            searchPos = mediaEnd;
            continue;
        }
        
        if (!needsGeneration) {
            searchPos = mediaEnd;
            continue;
        }
        
        try {
            // Normalize JSON: AI sometimes uses single quotes, HTML entities, etc.
            let normalizedJson = instructionJson
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&#39;/g, "'")
                .replace(/&#34;/g, '"')
                .replace(/&amp;/g, '&');
            
            const data = JSON.parse(normalizedJson);
            
            tags.push({
                fullMatch: fullImgTag,
                index: mediaStart,
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: true,
                mediaTagName: tagName,
                existingSrc: hasPath ? srcValue : null // Store existing src for logging
            });
            
            iigLog('INFO', `Found NEW format tag: ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse instruction JSON: ${instructionJson.substring(0, 100)}`, e.message);
        }
        
        searchPos = mediaEnd;
    }
    
    // === LEGACY FORMAT: [IMG:GEN:{...}] ===
    const marker = '[IMG:GEN:';
    let searchStart = 0;
    
    while (true) {
        const markerIndex = text.indexOf(marker, searchStart);
        if (markerIndex === -1) break;
        
        const jsonStart = markerIndex + marker.length;
        
        // Find the matching closing brace for JSON
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }
        }
        
        if (jsonEnd === -1) {
            searchStart = jsonStart;
            continue;
        }
        
        const jsonStr = text.substring(jsonStart, jsonEnd);
        
        const afterJson = text.substring(jsonEnd);
        if (!afterJson.startsWith(']')) {
            searchStart = jsonEnd;
            continue;
        }
        
        const tagOnly = text.substring(markerIndex, jsonEnd + 1);
        
        try {
            const normalizedJson = jsonStr.replace(/'/g, '"');
            const data = JSON.parse(normalizedJson);
            
            tags.push({
                fullMatch: tagOnly,
                index: markerIndex,
                style: data.style || '',
                prompt: data.prompt || '',
                aspectRatio: data.aspect_ratio || data.aspectRatio || null,
                preset: data.preset || null,
                imageSize: data.image_size || data.imageSize || null,
                quality: data.quality || null,
                isNewFormat: false
            });
            
            iigLog('INFO', `Found LEGACY format tag: ${data.prompt?.substring(0, 50)}`);
        } catch (e) {
            iigLog('WARN', `Failed to parse legacy tag JSON: ${jsonStr.substring(0, 100)}`, e.message);
        }
        
        searchStart = jsonEnd + 1;
    }
    
    return tags;
}

/**
 * Create loading placeholder element
 */
function createLoadingPlaceholder(tagId) {
    const placeholder = document.createElement('div');
    placeholder.className = 'iig-loading-placeholder';
    placeholder.dataset.tagId = tagId;
    placeholder.innerHTML = `
        <div class="iig-spinner"></div>
        <div class="iig-status">Генерация картинки...</div>
    `;
    return placeholder;
}

// Error image path - served from extension folder
const ERROR_IMAGE_PATH = '/scripts/extensions/third-party/sillyimages/error.svg';

/**
 * Create error placeholder element - just shows error.svg, no click handlers
 * User uses the regenerate button in message menu to retry
 */
function createErrorPlaceholder(tagId, errorMessage, tagInfo) {
    const img = document.createElement('img');
    img.className = 'iig-error-image';
    img.src = ERROR_IMAGE_PATH;
    img.alt = 'Ошибка генерации';
    img.title = `Ошибка: ${errorMessage}`;
    img.dataset.tagId = tagId;
    
    // Preserve data-iig-instruction for regenerate button functionality
    if (tagInfo.fullMatch) {
        const instructionMatch = tagInfo.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
        if (instructionMatch) {
            img.setAttribute('data-iig-instruction', instructionMatch[2]);
        }
    }
    
    return img;
}

/**
 * Process image tags in a message
 */
async function processMessageTags(messageId) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    
    if (!settings.enabled) return;
    
    // Prevent duplicate processing
    if (processingMessages.has(messageId)) {
        iigLog('WARN', `Message ${messageId} is already being processed, skipping`);
        return;
    }
    
    const message = context.chat[messageId];
    if (!message || message.is_user) return;
    
    // Check for tags, with file existence check to catch LLM hallucinations
    const tags = await parseMessageImageTags(message, { checkExistence: true });
    iigLog('INFO', `parseImageTags returned: ${tags.length} tags`);
    if (tags.length > 0) {
        iigLog('INFO', `First tag: ${JSON.stringify(tags[0]).substring(0, 200)}`);
    }
    if (tags.length === 0) {
        iigLog('INFO', 'No tags found by parser');
        return;
    }
    
    // Mark as processing
    processingMessages.add(messageId);
    iigLog('INFO', `Found ${tags.length} image tag(s) in message ${messageId}`);
    toastr.info(`Найдено тегов: ${tags.length}. Генерация...`, 'Генерация картинок', { timeOut: 3000 });
    
    // DOM is ready because we use CHARACTER_MESSAGE_RENDERED event
    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) {
        console.error('[IIG] Message element not found for ID:', messageId);
        toastr.error('Не удалось найти элемент сообщения', 'Генерация картинок');
        return;
    }
    
    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) return;
    
    // Process each tag in parallel
    const processTag = async (tag, index) => {
        const tagId = `iig-${messageId}-${index}`;
        
        iigLog('INFO', `Processing tag ${index}: ${tag.fullMatch.substring(0, 50)}`);
        
        // Create loading placeholder
        const loadingPlaceholder = createLoadingPlaceholder(tagId);
        let targetElement = null;
        
        if (tag.isNewFormat) {
            // NEW FORMAT: <img|video data-iig-instruction='...'> is a real DOM element
            const allImgs = mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]');
            iigLog('INFO', `Searching for media element. Found ${allImgs.length} [data-iig-instruction] elements in DOM`);
            
            // Debug: log what we're looking for vs what's in DOM
            const searchPrompt = tag.prompt.substring(0, 30);
            iigLog('INFO', `Searching for prompt starting with: "${searchPrompt}"`);
            
            for (const img of allImgs) {
                const instruction = img.getAttribute('data-iig-instruction');
                const src = img.getAttribute('src') || '';
                iigLog('INFO', `DOM img - src: "${src.substring(0, 50)}", instruction (first 100): "${instruction?.substring(0, 100)}"`);
                
                // Try multiple matching strategies
                if (instruction) {
                    // Strategy 1: Decode HTML entities and normalize quotes, then match
                    const decodedInstruction = instruction
                        .replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'")
                        .replace(/&#39;/g, "'")
                        .replace(/&#34;/g, '"')
                        .replace(/&amp;/g, '&');
                    
                    // Also normalize the search prompt the same way
                    const normalizedSearchPrompt = searchPrompt
                        .replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'")
                        .replace(/&#39;/g, "'")
                        .replace(/&#34;/g, '"')
                        .replace(/&amp;/g, '&');
                    
                    // Check if decoded instruction contains the prompt
                    if (decodedInstruction.includes(normalizedSearchPrompt)) {
                        iigLog('INFO', `Found img element via decoded instruction match`);
                        targetElement = img;
                        break;
                    }
                    
                    // Strategy 2: Try to parse the instruction as JSON and compare prompts
                    try {
                        const normalizedJson = decodedInstruction.replace(/'/g, '"');
                        const instructionData = JSON.parse(normalizedJson);
                        if (instructionData.prompt && instructionData.prompt.substring(0, 30) === tag.prompt.substring(0, 30)) {
                            iigLog('INFO', `Found img element via JSON prompt match`);
                            targetElement = img;
                            break;
                        }
                    } catch (e) {
                        // JSON parse failed, continue with other strategies
                    }
                    
                    // Strategy 3: Raw instruction contains raw search prompt (original approach)
                    if (instruction.includes(searchPrompt)) {
                        iigLog('INFO', `Found img element via raw instruction match`);
                        targetElement = img;
                        break;
                    }
                }
            }
            
            // Alternative: find by src containing markers (when prompt matching fails)
            if (!targetElement) {
                iigLog('INFO', `Prompt matching failed, trying src marker matching...`);
                for (const img of allImgs) {
                    const src = img.getAttribute('src') || '';
                    // Check for generation markers or empty/broken src
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]') || src === '' || src === '#') {
                        iigLog('INFO', `Found img element with generation marker in src: "${src}"`);
                        targetElement = img;
                        break;
                    }
                }
            }
            
            // Strategy 4: If still not found, try looking at all media nodes
            // This handles cases where browser didn't parse data-iig-instruction as a valid attribute
            if (!targetElement) {
                iigLog('INFO', `Trying broader media search...`);
                const allImgsInMes = mesTextEl.querySelectorAll('img, video');
                for (const img of allImgsInMes) {
                    const src = img.getAttribute('src') || '';
                    // Look for src containing our markers
                    if (src.includes('[IMG:GEN]') || src.includes('[IMG:ERROR]')) {
                        iigLog('INFO', `Found img via broad search with marker src: "${src.substring(0, 50)}"`);
                        targetElement = img;
                        break;
                    }
                }
            }
        } else {
            // LEGACY FORMAT: [IMG:GEN:{...}] - use regex replacement
            const tagEscaped = tag.fullMatch
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/"/g, '(?:"|&quot;)');
            const tagRegex = new RegExp(tagEscaped, 'g');
            
            const beforeReplace = mesTextEl.innerHTML;
            mesTextEl.innerHTML = mesTextEl.innerHTML.replace(
                tagRegex,
                `<span data-iig-placeholder="${tagId}"></span>`
            );
            
            if (beforeReplace !== mesTextEl.innerHTML) {
                targetElement = mesTextEl.querySelector(`[data-iig-placeholder="${tagId}"]`);
                iigLog('INFO', `Legacy tag replaced with placeholder span`);
            }
            
            // Also check for img src containing legacy tag
            if (!targetElement) {
                const allImgs = mesTextEl.querySelectorAll('img, video');
                for (const img of allImgs) {
                    if (img.src && img.src.includes('[IMG:GEN:')) {
                        targetElement = img;
                        iigLog('INFO', `Found img with legacy tag in src`);
                        break;
                    }
                }
            }
        }
        
        // Replace target with placeholder, preserving parent styling context
        if (targetElement) {
            // Copy some styling context from parent for adaptive placeholder
            const parent = targetElement.parentElement;
            if (parent) {
                const parentStyle = window.getComputedStyle(parent);
                if (parentStyle.display === 'flex' || parentStyle.display === 'grid') {
                    loadingPlaceholder.style.alignSelf = 'center';
                }
            }
            targetElement.replaceWith(loadingPlaceholder);
            iigLog('INFO', `Loading placeholder shown (replaced target element)`);
        } else {
            iigLog('WARN', `Could not find target element, appending placeholder as fallback`);
            mesTextEl.appendChild(loadingPlaceholder);
        }
        
        const statusEl = loadingPlaceholder.querySelector('.iig-status');
        
        try {
            const generated = await generateImageWithRetry(
                tag.prompt,
                tag.style,
                (status) => { statusEl.textContent = status; },
                { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId }
            );

            let persistedSrc = '';
            let persistedPosterSrc = '';
            if (isGeneratedVideoResult(generated)) {
                statusEl.textContent = 'Сохранение видео...';
                persistedSrc = await saveNaisteraMediaToFile(generated.dataUrl, 'video', {
                    messageId,
                    tagIndex: index,
                    mode: 'generate-video',
                    apiType: getSettings().apiType,
                });
                if (generated.posterDataUrl) {
                    statusEl.textContent = 'Сохранение превью...';
                    persistedPosterSrc = await saveImageToFile(generated.posterDataUrl, {
                        messageId,
                        tagIndex: index,
                        mode: 'generate-video-poster',
                        apiType: getSettings().apiType,
                    });
                }
            } else {
                statusEl.textContent = 'Сохранение...';
                persistedSrc = await saveImageToFile(generated, {
                    messageId,
                    tagIndex: index,
                    mode: 'generate',
                    apiType: getSettings().apiType,
                });
            }

            const mediaElement = createGeneratedMediaElement(
                isGeneratedVideoResult(generated)
                    ? { ...generated, dataUrl: persistedSrc, posterDataUrl: persistedPosterSrc || generated.posterDataUrl || '' }
                    : persistedSrc,
                tag,
            );

            // Preserve instruction for future regenerations (new format only)
            if (tag.isNewFormat) {
                const instructionMatch = tag.fullMatch.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
                if (instructionMatch) {
                    mediaElement.setAttribute('data-iig-instruction', instructionMatch[2]);
                }
            }

            // Wrap image with zoom/fullscreen/regen actions
            const wrappedElement = wrapImageWithActions(mediaElement, tag, messageId, index, tags.length);
            loadingPlaceholder.replaceWith(wrappedElement);

            if (tag.isNewFormat) {
                const updatedTag = isGeneratedVideoResult(generated)
                    ? buildPersistedVideoTag(tag.fullMatch, persistedSrc, persistedPosterSrc)
                    : tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${persistedSrc}"`);
                replaceTagInMessageSource(message, tag, updatedTag);
            } else {
                const completionMarker = isGeneratedVideoResult(generated)
                    ? `[VID:✓:${persistedSrc}]`
                    : `[IMG:✓:${persistedSrc}]`;
                replaceTagInMessageSource(message, tag, completionMarker);
            }

            iigLog('INFO', `Successfully generated ${isGeneratedVideoResult(generated) ? 'video' : 'image'} for tag ${index}`);
            toastr.success(
                `${isGeneratedVideoResult(generated) ? 'Видео' : 'Картинка'} ${index + 1}/${tags.length} готов${isGeneratedVideoResult(generated) ? 'о' : 'а'}`,
                'Генерация картинок',
                { timeOut: 2000 }
            );
        } catch (error) {
            iigLog('ERROR', `Failed to generate image for tag ${index}:`, error.message);
            
            // Replace with error placeholder
            const errorPlaceholder = createErrorPlaceholder(tagId, error.message, tag);
            loadingPlaceholder.replaceWith(errorPlaceholder);
            
            // IMPORTANT: Mark tag as failed in message.mes - use error.svg path so it displays properly after swipe
            if (tag.isNewFormat) {
                // NEW FORMAT: update src with error image path (will be detected for retry)
                const errorTag = tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${ERROR_IMAGE_PATH}"`);
                replaceTagInMessageSource(message, tag, errorTag);
            } else {
                // LEGACY FORMAT: replace with error marker
                const errorMarker = `[IMG:ERROR:${error.message.substring(0, 50)}]`;
                replaceTagInMessageSource(message, tag, errorMarker);
            }
            iigLog('INFO', `Marked tag as failed in message.mes`);
            
            toastr.error(`Ошибка генерации: ${error.message}`, 'Генерация картинок');
        }
    };
    
    try {
        // Process all tags in parallel
        await Promise.all(tags.map((tag, index) => processTag(tag, index)));
    } finally {
        // Always remove from processing set
        processingMessages.delete(messageId);
        iigLog('INFO', `Finished processing message ${messageId}`);
    }
    
    // Save chat to persist changes
    await context.saveChat();
    
    // Force re-render the message to show updated content
    // Use SillyTavern's messageFormatting if available
    if (typeof context.messageFormatting === 'function') {
        const formattedMessage = context.messageFormatting(
            getMessageRenderText(message, settings),
            message.name,
            message.is_system,
            message.is_user,
            messageId
        );
        mesTextEl.innerHTML = formattedMessage;
        console.log('[IIG] Message re-rendered via messageFormatting');
    } else {
        // Fallback: trigger a manual re-render by finding and updating the element
        const freshMessageEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
        if (freshMessageEl && message.mes) {
            // Simple approach: just reload the message content
            // This works because message.mes now contains the image path instead of the tag
            console.log('[IIG] Attempting manual refresh...');
        }
    }

    // Re-enhance images after the re-render (above re-render destroys wrappers)
    enhanceRenderedImages(mesTextEl, messageId);
}

/**
 * Regenerate all images in a message (user-triggered)
 */
async function regenerateMessageImages(messageId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    
    if (!message) {
        toastr.error('Сообщение не найдено', 'Генерация картинок');
        return;
    }
    
    // Parse ALL instruction tags, forcing regeneration
    const tags = await parseMessageImageTags(message, { forceAll: true });
    
    if (tags.length === 0) {
        toastr.warning('Нет тегов для перегенерации', 'Генерация картинок');
        return;
    }
    
    iigLog('INFO', `Regenerating ${tags.length} images in message ${messageId}`);
    toastr.info(`Перегенерация ${tags.length} картинок...`, 'Генерация картинок');
    
    // Process using existing logic
    processingMessages.add(messageId);
    
    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) {
        processingMessages.delete(messageId);
        return;
    }
    
    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(messageId);
        return;
    }
    
    for (let index = 0; index < tags.length; index++) {
        const tag = tags[index];
        const tagId = `iig-regen-${messageId}-${index}`;
        
        try {
            // Find the existing rendered media element with data-iig-instruction
            const existingMediaList = Array.from(
                mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]')
            );
            const existingMedia = existingMediaList[index] || existingMediaList[0] || null;
            if (existingMedia) {
                // Preserve the instruction for future regenerations
                const instruction = existingMedia.getAttribute('data-iig-instruction');
                
                const loadingPlaceholder = createLoadingPlaceholder(tagId);
                existingMedia.replaceWith(loadingPlaceholder);
                
                const statusEl = loadingPlaceholder.querySelector('.iig-status');
                
                const generated = await generateImageWithRetry(
                    tag.prompt,
                    tag.style,
                    (status) => { statusEl.textContent = status; },
                    { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId }
                );

                let persistedSrc = '';
                let persistedPosterSrc = '';
                if (isGeneratedVideoResult(generated)) {
                    statusEl.textContent = 'Сохранение видео...';
                    persistedSrc = await saveNaisteraMediaToFile(generated.dataUrl, 'video', {
                        messageId,
                        tagIndex: index,
                        mode: 'regenerate-video',
                        apiType: getSettings().apiType,
                    });
                    if (generated.posterDataUrl) {
                        statusEl.textContent = 'Сохранение превью...';
                        persistedPosterSrc = await saveImageToFile(generated.posterDataUrl, {
                            messageId,
                            tagIndex: index,
                            mode: 'regenerate-video-poster',
                            apiType: getSettings().apiType,
                        });
                    }
                } else {
                    statusEl.textContent = 'Сохранение...';
                    persistedSrc = await saveImageToFile(generated, {
                        messageId,
                        tagIndex: index,
                        mode: 'regenerate',
                        apiType: getSettings().apiType,
                    });
                }

                const mediaElement = createGeneratedMediaElement(
                    isGeneratedVideoResult(generated)
                        ? { ...generated, dataUrl: persistedSrc, posterDataUrl: persistedPosterSrc || generated.posterDataUrl || '' }
                        : persistedSrc,
                    tag,
                );
                if (instruction) {
                    mediaElement.setAttribute('data-iig-instruction', instruction);
                }

                // Wrap with actions
                const wrappedElement = wrapImageWithActions(mediaElement, tag, messageId, index, tags.length);
                loadingPlaceholder.replaceWith(wrappedElement);
                
                // Update message.mes
                const updatedTag = isGeneratedVideoResult(generated)
                    ? buildPersistedVideoTag(tag.fullMatch, persistedSrc, persistedPosterSrc)
                    : tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${persistedSrc}"`);
                replaceTagInMessageSource(message, tag, updatedTag);
                
                toastr.success(
                    `${isGeneratedVideoResult(generated) ? 'Видео' : 'Картинка'} ${index + 1}/${tags.length} готов${isGeneratedVideoResult(generated) ? 'о' : 'а'}`,
                    'Генерация картинок',
                    { timeOut: 2000 }
                );
            }
        } catch (error) {
            iigLog('ERROR', `Regeneration failed for tag ${index}:`, error.message);
            toastr.error(`Ошибка: ${error.message}`, 'Генерация картинок');
        }
    }
    
    processingMessages.delete(messageId);
    await context.saveChat();
    iigLog('INFO', `Regeneration complete for message ${messageId}`);
}

/**
 * Add regenerate button to message extra menu (three dots)
 */
function addRegenerateButton(messageElement, messageId) {
    // Check if button already exists
    if (messageElement.querySelector('.iig-regenerate-btn')) return;
    
    // Find the extraMesButtons container (three dots menu)
    const extraMesButtons = messageElement.querySelector('.extraMesButtons');
    if (!extraMesButtons) return;
    
    const btn = document.createElement('div');
    btn.className = 'mes_button iig-regenerate-btn fa-solid fa-images interactable';
    btn.title = 'Перегенерировать картинки';
    btn.tabIndex = 0;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await regenerateMessageImages(messageId);
    });
    
    extraMesButtons.appendChild(btn);
}

/**
 * Add regenerate buttons to all existing AI messages in chat
 */
function addButtonsToExistingMessages() {
    const context = SillyTavern.getContext();
    if (!context.chat || context.chat.length === 0) return;
    
    const messageElements = document.querySelectorAll('#chat .mes');
    let addedCount = 0;
    
    for (const messageElement of messageElements) {
        const mesId = messageElement.getAttribute('mesid');
        if (mesId === null) continue;
        
        const messageId = parseInt(mesId, 10);
        const message = context.chat[messageId];
        
        // Only add to AI messages (not user messages)
        if (message && !message.is_user) {
            addRegenerateButton(messageElement, messageId);
            const mesText = messageElement.querySelector('.mes_text');
            if (mesText) enhanceRenderedImages(mesText, messageId);
            addedCount++;
        }
    }
    
    iigLog('INFO', `Added regenerate buttons to ${addedCount} existing messages`);
}

// NOTE: No click handlers on error images - user uses the regenerate button in message menu

/**
 * Handle CHARACTER_MESSAGE_RENDERED event
 * This fires AFTER the message is rendered to DOM
 */
async function onMessageReceived(messageId) {
    iigLog('INFO', `onMessageReceived: ${messageId}`);
    
    const settings = getSettings();
    if (!settings.enabled) {
        iigLog('INFO', 'Extension disabled, skipping');
        return;
    }
    
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    
    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) return;
    
    // Always add regenerate button for AI messages
    addRegenerateButton(messageElement, messageId);
    
    await processMessageTags(messageId);
    
    // Enhance already-rendered images with zoom/fullscreen/regen buttons
    // Called AFTER processMessageTags to survive the messageFormatting re-render
    const mesTextElForEnhance = messageElement.querySelector('.mes_text');
    if (mesTextElForEnhance) {
        enhanceRenderedImages(mesTextElForEnhance, messageId);
    }
}

/**
 * Create settings UI
 */
function createSettingsUI() {
    const settings = getSettings();
    const context = SillyTavern.getContext();
    
    const container = document.getElementById('extensions_settings');
    if (!container) {
        console.error('[IIG] Settings container not found');
        return;
    }
    
    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Генерация картинок</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="iig-settings">
                    <!-- Вкл/Выкл -->
                    <label class="checkbox_label">
                        <input type="checkbox" id="iig_enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>Включить генерацию картинок</span>
                    </label>
                    <label class="checkbox_label" style="margin-top: 6px;">
                        <input type="checkbox" id="iig_external_blocks" ${settings.externalBlocks ? 'checked' : ''}>
                        <span>Работа с внешними блоками</span>
                    </label>
                    
                    <hr>
                    
                    <h4>Настройки API</h4>
                    
                    <!-- Тип эндпоинта -->
                    <div class="flex-row">
                        <label for="iig_api_type">Тип API</label>
                        <select id="iig_api_type" class="flex1">
                            <option value="openai" ${settings.apiType === 'openai' ? 'selected' : ''}>OpenAI-совместимый (/v1/images/generations)</option>
                            <option value="gemini" ${settings.apiType === 'gemini' ? 'selected' : ''}>Gemini-совместимый (nano-banana)</option>
                            <option value="naistera" ${settings.apiType === 'naistera' ? 'selected' : ''}>Naistera (naistera.org)</option>
                        </select>
                    </div>
                    
                    <!-- URL эндпоинта -->
                    <div class="flex-row">
                        <label for="iig_endpoint">URL эндпоинта</label>
                        <input type="text" id="iig_endpoint" class="text_pole flex1" 
                               value="${settings.endpoint}" 
                               placeholder="https://api.example.com">
                    </div>
                    
                    <!-- API ключ -->
                    <div class="flex-row">
                        <label for="iig_api_key">API ключ</label>
                        <input type="password" id="iig_api_key" class="text_pole flex1" 
                               value="${settings.apiKey}">
                        <div id="iig_key_toggle" class="menu_button iig-key-toggle" title="Показать/Скрыть">
                            <i class="fa-solid fa-eye"></i>
                        </div>
                    </div>
                    <p id="iig_naistera_hint" class="hint ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}">Для Naistera: вставьте токен из Telegram бота и выберите модель (grok / nano banana).</p>
                    
                    <!-- Модель -->
                    <div class="flex-row ${settings.apiType === 'naistera' ? 'iig-hidden' : ''}" id="iig_model_row">
                        <label for="iig_model">Модель</label>
                        <select id="iig_model" class="flex1">
                            ${settings.model ? `<option value="${settings.model}" selected>${settings.model}</option>` : '<option value="">-- Выберите модель --</option>'}
                        </select>
                        <div id="iig_refresh_models" class="menu_button iig-refresh-btn" title="Обновить список">
                            <i class="fa-solid fa-sync"></i>
                        </div>
                    </div>
                    
                    <hr>

                    <div class="iig-settings-card ${['naistera', 'gemini'].includes(settings.apiType) ? '' : 'iig-hidden'}" id="iig_image_context_section">
                        <h4>Контекст картинок</h4>
                        <p class="hint">Добавляет к генерации несколько предыдущих картинок из чата как контекст сцен и стиля.</p>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_image_context_enabled" ${settings.imageContextEnabled ? 'checked' : ''}>
                            <span>Включить контекст картинок</span>
                        </label>
                        <div class="iig-video-frequency-row ${settings.imageContextEnabled ? '' : 'iig-hidden'}" id="iig_image_context_count_row">
                            <div class="iig-video-frequency-input">
                                <span>Использовать</span>
                                <input
                                    type="number"
                                    id="iig_image_context_count"
                                    class="text_pole"
                                    min="1"
                                    max="${MAX_CONTEXT_IMAGES}"
                                    step="1"
                                    value="${normalizeImageContextCount(settings.imageContextCount)}"
                                >
                                <span>предыдущих картинок.</span>
                            </div>
                        </div>
                    </div>

                    <div class="iig-settings-card">
                        <h4>Параметры генерации</h4>

                        <!-- Размер -->
                        <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_size_row">
                            <label for="iig_size">Размер</label>
                            <select id="iig_size" class="flex1">
                                <option value="1024x1024" ${settings.size === '1024x1024' ? 'selected' : ''}>1024x1024 (Квадрат)</option>
                                <option value="1792x1024" ${settings.size === '1792x1024' ? 'selected' : ''}>1792x1024 (Альбомная)</option>
                                <option value="1024x1792" ${settings.size === '1024x1792' ? 'selected' : ''}>1024x1792 (Портретная)</option>
                                <option value="512x512" ${settings.size === '512x512' ? 'selected' : ''}>512x512 (Маленький)</option>
                            </select>
                        </div>

                        <!-- Качество -->
                        <div class="flex-row ${settings.apiType !== 'openai' ? 'iig-hidden' : ''}" id="iig_quality_row">
                            <label for="iig_quality">Качество</label>
                            <select id="iig_quality" class="flex1">
                                <option value="standard" ${settings.quality === 'standard' ? 'selected' : ''}>Стандартное</option>
                                <option value="hd" ${settings.quality === 'hd' ? 'selected' : ''}>HD</option>
                            </select>
                        </div>

                        <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_model_row">
                            <label for="iig_naistera_model">Модель</label>
                            <select id="iig_naistera_model" class="flex1">
                                <option value="grok" ${normalizeNaisteraModel(settings.naisteraModel) === 'grok' ? 'selected' : ''}>grok</option>
                                <option value="nano banana" ${normalizeNaisteraModel(settings.naisteraModel) === 'nano banana' ? 'selected' : ''}>nano banana</option>
                            </select>
                        </div>
                        <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_aspect_row">
                            <label for="iig_naistera_aspect_ratio">Соотношение сторон</label>
                            <select id="iig_naistera_aspect_ratio" class="flex1">
                                <option value="1:1" ${settings.naisteraAspectRatio === '1:1' ? 'selected' : ''}>1:1</option>
                                <option value="16:9" ${settings.naisteraAspectRatio === '16:9' ? 'selected' : ''}>16:9</option>
                                <option value="9:16" ${settings.naisteraAspectRatio === '9:16' ? 'selected' : ''}>9:16</option>
                                <option value="3:2" ${settings.naisteraAspectRatio === '3:2' ? 'selected' : ''}>3:2</option>
                                <option value="2:3" ${settings.naisteraAspectRatio === '2:3' ? 'selected' : ''}>2:3</option>
                            </select>
                        </div>

                        <div id="iig_avatar_section" class="iig-settings-card-nested ${settings.apiType !== 'gemini' ? 'hidden' : ''}">
                            <div class="flex-row">
                                <label for="iig_aspect_ratio">Соотношение сторон</label>
                                <select id="iig_aspect_ratio" class="flex1">
                                    <option value="1:1" ${settings.aspectRatio === '1:1' ? 'selected' : ''}>1:1 (Квадрат)</option>
                                    <option value="2:3" ${settings.aspectRatio === '2:3' ? 'selected' : ''}>2:3 (Портрет)</option>
                                    <option value="3:2" ${settings.aspectRatio === '3:2' ? 'selected' : ''}>3:2 (Альбом)</option>
                                    <option value="3:4" ${settings.aspectRatio === '3:4' ? 'selected' : ''}>3:4 (Портрет)</option>
                                    <option value="4:3" ${settings.aspectRatio === '4:3' ? 'selected' : ''}>4:3 (Альбом)</option>
                                    <option value="4:5" ${settings.aspectRatio === '4:5' ? 'selected' : ''}>4:5 (Портрет)</option>
                                    <option value="5:4" ${settings.aspectRatio === '5:4' ? 'selected' : ''}>5:4 (Альбом)</option>
                                    <option value="9:16" ${settings.aspectRatio === '9:16' ? 'selected' : ''}>9:16 (Вертикальный)</option>
                                    <option value="16:9" ${settings.aspectRatio === '16:9' ? 'selected' : ''}>16:9 (Широкий)</option>
                                    <option value="21:9" ${settings.aspectRatio === '21:9' ? 'selected' : ''}>21:9 (Ультраширокий)</option>
                                </select>
                            </div>
                            <div class="flex-row">
                                <label for="iig_image_size">Разрешение</label>
                                <select id="iig_image_size" class="flex1">
                                    <option value="1K" ${settings.imageSize === '1K' ? 'selected' : ''}>1K (по умолчанию)</option>
                                    <option value="2K" ${settings.imageSize === '2K' ? 'selected' : ''}>2K</option>
                                    <option value="4K" ${settings.imageSize === '4K' ? 'selected' : ''}>4K</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="iig-settings-card ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_refs_section">
                        <h4>Референсы</h4>
                        <p class="hint">Отправлять аватарки как референсы для консистентной генерации персонажей.</p>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_naistera_send_char_avatar" ${settings.naisteraSendCharAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар {{char}}</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_naistera_send_user_avatar" ${settings.naisteraSendUserAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар {{user}}</span>
                        </label>
                        <div id="iig_naistera_user_avatar_row" class="flex-row ${!settings.naisteraSendUserAvatar ? 'iig-hidden' : ''}" style="margin-top: 5px;">
                            <label for="iig_naistera_user_avatar_file">Аватар {{user}}</label>
                            <select id="iig_naistera_user_avatar_file" class="flex1">
                                <option value="">-- Не выбран --</option>
                                ${settings.userAvatarFile ? `<option value="${settings.userAvatarFile}" selected>${settings.userAvatarFile}</option>` : ''}
                            </select>
                            <div id="iig_naistera_refresh_avatars" class="menu_button iig-refresh-btn" title="Обновить список">
                                <i class="fa-solid fa-sync"></i>
                            </div>
                        </div>
                    </div>

                    <div id="iig_avatar_refs_section" class="iig-settings-card ${settings.apiType !== 'gemini' ? 'hidden' : ''}">
                        <h4>Референсы</h4>
                        <p class="hint">Отправлять аватарки как референсы для консистентной генерации персонажей.</p>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_send_char_avatar" ${settings.sendCharAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар {{char}}</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_send_user_avatar" ${settings.sendUserAvatar ? 'checked' : ''}>
                            <span>Отправлять аватар {{user}}</span>
                        </label>
                        <div id="iig_user_avatar_row" class="flex-row ${!settings.sendUserAvatar ? 'hidden' : ''}" style="margin-top: 5px;">
                            <label for="iig_user_avatar_file">Аватар {{user}}</label>
                            <select id="iig_user_avatar_file" class="flex1">
                                <option value="">-- Не выбран --</option>
                                ${settings.userAvatarFile ? `<option value="${settings.userAvatarFile}" selected>${settings.userAvatarFile}</option>` : ''}
                            </select>
                            <div id="iig_refresh_avatars" class="menu_button iig-refresh-btn" title="Обновить список">
                                <i class="fa-solid fa-sync"></i>
                            </div>
                        </div>
                    </div>

                    <div class="iig-settings-card ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_video_section">
                        <h4>Видео</h4>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_naistera_video_test" ${settings.naisteraVideoTest ? 'checked' : ''}>
                            <span>Включить генерацию видео</span>
                        </label>
                        <div class="iig-video-frequency-row ${settings.naisteraVideoTest ? '' : 'iig-hidden'}" id="iig_naistera_video_frequency_row">
                            <div class="iig-video-frequency-input">
                                <span>Каждые</span>
                                <input
                                    type="number"
                                    id="iig_naistera_video_every_n"
                                    class="text_pole"
                                    min="1"
                                    max="999"
                                    step="1"
                                    value="${normalizeNaisteraVideoFrequency(settings.naisteraVideoEveryN)}"
                                >
                                <span>сообщений.</span>
                            </div>
                        </div>
                    </div>

                    <hr>

                    <div class="iig-settings-card">
                        <h4>Обработка ошибок</h4>
                    
                        <div class="flex-row">
                            <label for="iig_max_retries">Макс. повторов</label>
                            <input type="number" id="iig_max_retries" class="text_pole flex1" 
                                   value="${settings.maxRetries}" min="0" max="5">
                        </div>
                        <div class="flex-row">
                            <label for="iig_retry_delay">Задержка (мс)</label>
                            <input type="number" id="iig_retry_delay" class="text_pole flex1" 
                                   value="${settings.retryDelay}" min="500" max="10000" step="500">
                        </div>
                    </div>

                    <div class="iig-settings-card">
                        <h4>Референс стиля</h4>
                        <p class="hint">Загрузите картинку-референс. Из неё будет браться ТОЛЬКО стиль рисовки (палитра, техника, текстуры). Содержимое/сюжет картинки будут проигнорированы.</p>
                        <div class="flex-row">
                            <div id="iig_style_ref_upload" class="menu_button" style="width: 100%;">
                                <i class="fa-solid fa-palette"></i> Загрузить референс стиля
                            </div>
                        </div>
                        <div id="iig_style_ref_preview" class="iig-style-ref-preview" style="${settings.styleRefBase64 ? '' : 'display:none'}">
                            <img id="iig_style_ref_img" src="${settings.styleRefBase64 ? 'data:image/png;base64,' + settings.styleRefBase64 : ''}" alt="Style ref">
                            <span id="iig_style_ref_name">${settings.styleRefName || ''}</span>
                            <div id="iig_style_ref_remove" class="menu_button iig-style-ref-remove" title="Удалить референс">
                                <i class="fa-solid fa-trash-can"></i>
                            </div>
                        </div>
                    </div>

                    <div class="iig-settings-card">
                        <h4>Гардероб</h4>
                        <p class="hint" style="margin-bottom:8px;">Загрузите аутфиты для бота и юзера. Активный аутфит отправляется как reference-изображение при генерации.</p>
                        <div class="flex-row">
                            <div id="sw_open_wardrobe" class="menu_button" style="width: 100%;">
                                <i class="fa-solid fa-shirt"></i> Открыть гардероб
                            </div>
                        </div>
                        <label class="checkbox_label" style="margin-top:8px;">
                            <input type="checkbox" id="sw_show_float">
                            <span>Плавающая кнопка в чате</span>
                        </label>
                        <div class="flex-row" style="margin-top:6px;">
                            <label for="sw_max_dim">Макс. размер (px)</label>
                            <input type="number" id="sw_max_dim" class="text_pole flex1" value="512" min="128" max="1024" step="64">
                        </div>
                    </div>

                    <div class="iig-settings-card">
                        <h4>Отладка</h4>
                        <div class="flex-row">
                            <div id="iig_export_logs" class="menu_button" style="width: 100%;">
                                <i class="fa-solid fa-download"></i> Экспорт логов
                            </div>
                        </div>
                        <p class="hint">Экспортировать логи расширения для отладки проблем.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', html);
    
    // Bind event handlers
    bindSettingsEvents();
}

/**
 * Bind settings event handlers
 */
function bindSettingsEvents() {
    const settings = getSettings();

    const updateVisibility = () => {
        const apiType = settings.apiType;
        const isNaistera = apiType === 'naistera';
        const isGemini = apiType === 'gemini';
        const isOpenAI = apiType === 'openai';

        // Model is used for OpenAI and Gemini; Naistera does not need a model.
        document.getElementById('iig_model_row')?.classList.toggle('iig-hidden', isNaistera);
        document.getElementById('iig_image_context_section')?.classList.toggle('iig-hidden', !(isNaistera || isGemini));
        document.getElementById('iig_image_context_count_row')?.classList.toggle('iig-hidden', !((isNaistera || isGemini) && settings.imageContextEnabled));

        // OpenAI-only params
        document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !isOpenAI);
        document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !isOpenAI);

        // Naistera-only params
        document.getElementById('iig_naistera_model_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_aspect_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_section')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_frequency_row')?.classList.toggle('iig-hidden', !(isNaistera && settings.naisteraVideoTest));
        document.getElementById('iig_naistera_refs_section')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_user_avatar_row')?.classList.toggle('iig-hidden', !(isNaistera && settings.naisteraSendUserAvatar));

        document.getElementById('iig_naistera_hint')?.classList.toggle('iig-hidden', !isNaistera);

        const endpointInput = document.getElementById('iig_endpoint');
        if (endpointInput) {
            endpointInput.placeholder = getEndpointPlaceholder(apiType);
        }

        // Avatar section is only for Gemini/nano-banana
        const avatarSection = document.getElementById('iig_avatar_section');
        if (avatarSection) {
            avatarSection.classList.toggle('hidden', !isGemini);
        }
        const avatarRefsSection = document.getElementById('iig_avatar_refs_section');
        if (avatarRefsSection) {
            avatarRefsSection.classList.toggle('hidden', !isGemini);
        }
    };
    
    // Enable toggle
    document.getElementById('iig_enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_external_blocks')?.addEventListener('change', (e) => {
        settings.externalBlocks = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_image_context_enabled')?.addEventListener('change', (e) => {
        settings.imageContextEnabled = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_image_context_count')?.addEventListener('input', (e) => {
        const normalized = normalizeImageContextCount(e.target.value);
        settings.imageContextCount = normalized;
        e.target.value = String(normalized);
        saveSettings();
    });
    
    // API Type
    document.getElementById('iig_api_type')?.addEventListener('change', (e) => {
        const nextApiType = e.target.value;
        const endpointInput = document.getElementById('iig_endpoint');
        if (shouldReplaceEndpointForApiType(nextApiType, settings.endpoint)) {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, '');
            if (endpointInput) {
                endpointInput.value = settings.endpoint;
            }
        } else if (nextApiType === 'naistera') {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, settings.endpoint);
            if (endpointInput) {
                endpointInput.value = settings.endpoint;
            }
        }
        settings.apiType = nextApiType;
        saveSettings();
        updateVisibility();
    });
    
    // Endpoint
    document.getElementById('iig_endpoint')?.addEventListener('input', (e) => {
        settings.endpoint = e.target.value;
        saveSettings();
    });
    
    // API Key
    document.getElementById('iig_api_key')?.addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        saveSettings();
    });
    
    // API Key toggle visibility
    document.getElementById('iig_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_api_key');
        const icon = document.querySelector('#iig_key_toggle i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });
    
    // Model
    document.getElementById('iig_model')?.addEventListener('change', (e) => {
        settings.model = e.target.value;
        saveSettings();
        
        // Auto-switch API type based on model
        if (isGeminiModel(e.target.value)) {
            document.getElementById('iig_api_type').value = 'gemini';
            settings.apiType = 'gemini';
            updateVisibility();
        }
    });
    
    // Refresh models
    document.getElementById('iig_refresh_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        
        try {
            const models = await fetchModels();
            const select = document.getElementById('iig_model');
            
            // Keep current selection if it exists in new list
            const currentModel = settings.model;
            
            select.innerHTML = '<option value="">-- Выберите модель --</option>';
            
            for (const model of models) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                option.selected = model === currentModel;
                select.appendChild(option);
            }
            
            toastr.success(`Найдено моделей: ${models.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки моделей', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });
    
    // Size
    document.getElementById('iig_size')?.addEventListener('change', (e) => {
        settings.size = e.target.value;
        saveSettings();
    });
    
    // Quality
    document.getElementById('iig_quality')?.addEventListener('change', (e) => {
        settings.quality = e.target.value;
        saveSettings();
    });
    
    // Aspect Ratio (nano-banana)
    document.getElementById('iig_aspect_ratio')?.addEventListener('change', (e) => {
        settings.aspectRatio = e.target.value;
        saveSettings();
    });
    
    // Image Size (nano-banana)
    document.getElementById('iig_image_size')?.addEventListener('change', (e) => {
        settings.imageSize = e.target.value;
        saveSettings();
    });

    // Naistera aspect ratio
    document.getElementById('iig_naistera_model')?.addEventListener('change', (e) => {
        settings.naisteraModel = normalizeNaisteraModel(e.target.value);
        saveSettings();
    });

    // Naistera aspect ratio
    document.getElementById('iig_naistera_aspect_ratio')?.addEventListener('change', (e) => {
        settings.naisteraAspectRatio = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_video_test')?.addEventListener('change', (e) => {
        settings.naisteraVideoTest = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_naistera_video_every_n')?.addEventListener('input', (e) => {
        const normalized = normalizeNaisteraVideoFrequency(e.target.value);
        settings.naisteraVideoEveryN = normalized;
        e.target.value = String(normalized);
        saveSettings();
    });

    // Naistera references (UI only for now)
    document.getElementById('iig_naistera_send_char_avatar')?.addEventListener('change', (e) => {
        settings.naisteraSendCharAvatar = e.target.checked;
        saveSettings();
    });
    document.getElementById('iig_naistera_send_user_avatar')?.addEventListener('change', (e) => {
        settings.naisteraSendUserAvatar = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    // Naistera user avatar file selection (reuses settings.userAvatarFile)
    document.getElementById('iig_naistera_user_avatar_file')?.addEventListener('change', (e) => {
        settings.userAvatarFile = e.target.value;
        saveSettings();
    });

    // Naistera refresh user avatars list
    document.getElementById('iig_naistera_refresh_avatars')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');

        try {
            const avatars = await fetchUserAvatars();
            const select = document.getElementById('iig_naistera_user_avatar_file');
            const currentAvatar = settings.userAvatarFile;

            select.innerHTML = '<option value="">-- Не выбран --</option>';

            for (const avatar of avatars) {
                const option = document.createElement('option');
                option.value = avatar;
                option.textContent = avatar;
                option.selected = avatar === currentAvatar;
                select.appendChild(option);
            }

            toastr.success(`Найдено аватаров: ${avatars.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки аватаров', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });
    
    // Send char avatar
    document.getElementById('iig_send_char_avatar')?.addEventListener('change', (e) => {
        settings.sendCharAvatar = e.target.checked;
        saveSettings();
    });
    
    // Send user avatar
    document.getElementById('iig_send_user_avatar')?.addEventListener('change', (e) => {
        settings.sendUserAvatar = e.target.checked;
        saveSettings();
        
        // Show/hide avatar selection row
        const avatarRow = document.getElementById('iig_user_avatar_row');
        if (avatarRow) {
            avatarRow.classList.toggle('hidden', !e.target.checked);
        }
    });
    
    // User avatar file selection
    document.getElementById('iig_user_avatar_file')?.addEventListener('change', (e) => {
        settings.userAvatarFile = e.target.value;
        saveSettings();
    });
    
    // Refresh user avatars list
    document.getElementById('iig_refresh_avatars')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        
        try {
            const avatars = await fetchUserAvatars();
            const select = document.getElementById('iig_user_avatar_file');
            const currentAvatar = settings.userAvatarFile;
            
            select.innerHTML = '<option value="">-- Не выбран --</option>';
            
            for (const avatar of avatars) {
                const option = document.createElement('option');
                option.value = avatar;
                option.textContent = avatar;
                option.selected = avatar === currentAvatar;
                select.appendChild(option);
            }
            
            toastr.success(`Найдено аватаров: ${avatars.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки аватаров', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });
    
    // Max retries
    document.getElementById('iig_max_retries')?.addEventListener('input', (e) => {
        settings.maxRetries = parseInt(e.target.value) || 3;
        saveSettings();
    });
    
    // Retry delay
    document.getElementById('iig_retry_delay')?.addEventListener('input', (e) => {
        settings.retryDelay = parseInt(e.target.value) || 1000;
        saveSettings();
    });
    
    // Export logs
    document.getElementById('iig_export_logs')?.addEventListener('click', () => {
        exportLogs();
    });

    // ── Style reference handlers ──
    document.getElementById('iig_style_ref_upload')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.addEventListener('change', async () => {
            const f = inp.files?.[0];
            if (!f) return;
            try {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        // Resize to max 512px
                        let { width: w, height: h } = img;
                        const maxDim = 512;
                        if (w > maxDim || h > maxDim) {
                            const s = Math.min(maxDim / w, maxDim / h);
                            w = Math.round(w * s);
                            h = Math.round(h * s);
                        }
                        const c = document.createElement('canvas');
                        c.width = w;
                        c.height = h;
                        c.getContext('2d').drawImage(img, 0, 0, w, h);
                        const base64 = c.toDataURL('image/png').split(',')[1];

                        settings.styleRefBase64 = base64;
                        settings.styleRefName = f.name.replace(/\.[^.]+$/, '');
                        saveSettings();

                        const preview = document.getElementById('iig_style_ref_preview');
                        const previewImg = document.getElementById('iig_style_ref_img');
                        const nameEl = document.getElementById('iig_style_ref_name');
                        if (preview) preview.style.display = '';
                        if (previewImg) previewImg.src = `data:image/png;base64,${base64}`;
                        if (nameEl) nameEl.textContent = settings.styleRefName;
                        toastr.success('Референс стиля загружен', 'Генерация картинок');
                    };
                    img.onerror = () => toastr.error('Ошибка декодирования', 'Генерация картинок');
                    img.src = e.target.result;
                };
                reader.readAsDataURL(f);
            } catch (e) {
                toastr.error('Ошибка: ' + e.message, 'Генерация картинок');
            }
        });
        inp.click();
    });

    document.getElementById('iig_style_ref_remove')?.addEventListener('click', () => {
        settings.styleRefBase64 = '';
        settings.styleRefName = '';
        saveSettings();
        const preview = document.getElementById('iig_style_ref_preview');
        if (preview) preview.style.display = 'none';
        toastr.info('Референс стиля удалён', 'Генерация картинок');
    });

    // ── Wardrobe handlers ──
    document.getElementById('sw_open_wardrobe')?.addEventListener('click', () => {
        if (window.sillyWardrobe?.isReady()) {
            window.sillyWardrobe.openModal();
        } else {
            toastr.error('Гардероб не загружен', 'Гардероб');
        }
    });
    const swFloatCheck = document.getElementById('sw_show_float');
    if (swFloatCheck) {
        const swS = SillyTavern.getContext().extensionSettings.silly_wardrobe;
        if (swS) swFloatCheck.checked = !!swS.showFloatingBtn;
        swFloatCheck.addEventListener('change', () => {
            const s = SillyTavern.getContext().extensionSettings.silly_wardrobe;
            if (s) { s.showFloatingBtn = swFloatCheck.checked; SillyTavern.getContext().saveSettingsDebounced(); }
            $('#sw-float-btn').toggle(swFloatCheck.checked);
        });
    }
    document.getElementById('sw_max_dim')?.addEventListener('change', (e) => {
        const ctx = SillyTavern.getContext();
        if (ctx.extensionSettings.silly_wardrobe) {
            ctx.extensionSettings.silly_wardrobe.maxDimension = Math.max(128, Math.min(1024, parseInt(e.target.value) || 512));
            ctx.saveSettingsDebounced();
        }
    });

    // Apply initial state
    updateVisibility();
}

/**
 * ═══════════════════════════════════════════
 * Fullscreen image viewer with zoom
 * ═══════════════════════════════════════════
 */
function openFullscreenViewer(imgSrc) {
    console.log('[IIG] openFullscreenViewer called with src:', imgSrc ? imgSrc.substring(0, 200) : 'EMPTY');
    if (!imgSrc) { console.error('[IIG] openFullscreenViewer: no src!'); return; }
    closeFullscreenViewer();
    const overlay = document.createElement('div');
    overlay.id = 'iig-fullscreen-overlay';
    overlay.classList.add('iig-fs-fit');

    const img = document.createElement('img');
    img.className = 'iig-fs-image';
    img.src = imgSrc;
    img.alt = 'Fullscreen';
    img.draggable = false;

    // Debug: show src and load status on overlay
    const dbg = document.createElement('div');
    dbg.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;color:lime;font-size:11px;word-break:break-all;z-index:100002;background:rgba(0,0,0,0.8);padding:8px;border-radius:6px;max-height:30vh;overflow:auto;';
    dbg.textContent = 'SRC: ' + imgSrc.substring(0, 300);
    img.onload = () => { dbg.textContent += ' | LOADED OK (' + img.naturalWidth + 'x' + img.naturalHeight + ')'; };
    img.onerror = () => { dbg.textContent += ' | LOAD ERROR'; };

    const closeBtn = document.createElement('div');
    closeBtn.className = 'iig-fs-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeFullscreenViewer(); });
    closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); closeFullscreenViewer(); });

    // Tap on overlay background → close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFullscreenViewer();
    });

    // Tap on image → toggle zoom/fit
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (overlay.classList.contains('iig-fs-fit')) {
            overlay.classList.remove('iig-fs-fit');
            overlay.classList.add('iig-fs-zoom');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    overlay.scrollTo(
                        Math.max(0, (overlay.scrollWidth - overlay.clientWidth) / 2),
                        Math.max(0, (overlay.scrollHeight - overlay.clientHeight) / 2)
                    );
                });
            });
        } else {
            overlay.classList.remove('iig-fs-zoom');
            overlay.classList.add('iig-fs-fit');
        }
    });

    const handleKey = (e) => {
        if (e.key === 'Escape') closeFullscreenViewer();
    };
    document.addEventListener('keydown', handleKey);
    overlay._iigKeyHandler = handleKey;

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    overlay.appendChild(dbg);
    document.body.appendChild(overlay);
}

function closeFullscreenViewer() {
    const existing = document.getElementById('iig-fullscreen-overlay');
    if (existing) {
        if (existing._iigKeyHandler) document.removeEventListener('keydown', existing._iigKeyHandler);
        existing.remove();
    }
}

/**
 * Global delegated click handler for all IIG image interactions.
 * Uses capture phase to intercept before SillyTavern's own handlers.
 * This is robust against DOM re-renders since it doesn't rely on per-element handlers.
 */
function initGlobalClickHandler() {
    // ── Touch support: tap image to show buttons, tap button to act ──
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let _iigTouchJustActivated = null; // track which wrapper was activated on this touch
    if (isTouchDevice) {
        document.addEventListener('touchstart', (e) => {
            const wrapper = e.target.closest('.iig-image-wrapper');
            const btn = e.target.closest('.iig-image-action-btn');
            if (btn) {
                // Tapping a button — don't change activation state
                _iigTouchJustActivated = null;
                return;
            }
            if (wrapper) {
                if (wrapper.classList.contains('iig-touch-active')) {
                    // Already active — this is a second tap on the image
                    _iigTouchJustActivated = null;
                } else {
                    // First tap — activate and remember
                    document.querySelectorAll('.iig-image-wrapper.iig-touch-active').forEach(w => w.classList.remove('iig-touch-active'));
                    wrapper.classList.add('iig-touch-active');
                    _iigTouchJustActivated = wrapper;
                }
            } else {
                // Tapped outside any wrapper — hide all
                document.querySelectorAll('.iig-image-wrapper.iig-touch-active').forEach(w => w.classList.remove('iig-touch-active'));
                _iigTouchJustActivated = null;
            }
        }, { passive: true });
    }

    document.addEventListener('click', (e) => {
        // Don't interfere with SillyWardrobe modal clicks
        if (e.target.closest('#sw-modal-overlay, #sw-modal')) return;

        // === Fullscreen overlay interactions ===
        const overlay = document.getElementById('iig-fullscreen-overlay');
        if (overlay) {
            // Close button
            if (e.target.closest('.iig-fs-close')) {
                e.preventDefault();
                e.stopPropagation();
                closeFullscreenViewer();
                return;
            }

            // Click on fullscreen image → toggle zoom
            const fsImg = e.target.closest('.iig-fs-image');
            if (fsImg) {
                e.preventDefault();
                e.stopPropagation();
                const isFit = overlay.classList.contains('iig-fs-fit');
                if (isFit) {
                    // Switch to zoom mode
                    overlay.classList.remove('iig-fs-fit');
                    overlay.classList.add('iig-fs-zoom');
                    // Wait for layout, then scroll to center of image
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const scrollX = Math.max(0, (overlay.scrollWidth - overlay.clientWidth) / 2);
                            const scrollY = Math.max(0, (overlay.scrollHeight - overlay.clientHeight) / 2);
                            overlay.scrollTo(scrollX, scrollY);
                        });
                    });
                } else {
                    // Switch back to fit mode
                    overlay.classList.remove('iig-fs-zoom');
                    overlay.classList.add('iig-fs-fit');
                }
                return;
            }

            // Click on overlay background → close
            if (e.target === overlay) {
                e.preventDefault();
                e.stopPropagation();
                closeFullscreenViewer();
                return;
            }
            return;
        }

        // === Chat image interactions ===

        // Fullscreen button on image wrapper
        const fsBtn = e.target.closest('.iig-image-action-btn:not(.iig-regen-single-btn)');
        if (fsBtn) {
            e.preventDefault();
            e.stopPropagation();
            const wrapper = fsBtn.closest('.iig-image-wrapper');
            const img = wrapper?.querySelector('img');
            if (img?.src) openFullscreenViewer(img.src);
            return;
        }

        // Per-image regen button
        const regenBtn = e.target.closest('.iig-regen-single-btn');
        if (regenBtn) {
            e.preventDefault();
            e.stopPropagation();
            const msgId = parseInt(regenBtn.dataset.messageId, 10);
            const tagIdx = parseInt(regenBtn.dataset.tagIndex, 10);
            if (!isNaN(msgId) && !isNaN(tagIdx)) {
                regenerateSingleImage(msgId, tagIdx);
            }
            return;
        }

        // Direct click on an IIG image (either wrapped or bare) → fullscreen
        // On touch: first tap shows buttons, only open fullscreen on second tap
        const clickedImg = e.target.closest('.iig-image-wrapper img, img.iig-generated-image, img[data-iig-instruction]');
        if (clickedImg) {
            const wrapper = clickedImg.closest('.iig-image-wrapper');
            if (isTouchDevice && wrapper && _iigTouchJustActivated === wrapper) {
                // First tap — just showed buttons, don't open fullscreen
                _iigTouchJustActivated = null;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            _iigTouchJustActivated = null;
            const src = clickedImg.getAttribute('src') || '';
            iigLog('INFO', `Image click detected: src=${src.substring(0, 80)}, hasWrapper=${!!wrapper}`);
            if (src && !src.includes('error.svg') && !src.includes('[IMG:') && !src.includes('[VID:')) {
                e.preventDefault();
                e.stopPropagation();
                openFullscreenViewer(src);
                return;
            }
        }

        // Fallback: any img inside .mes_text that has a real path src (not base64, not marker)
        const anyMesImg = e.target.closest('.mes_text img');
        if (anyMesImg) {
            const src = anyMesImg.getAttribute('src') || '';
            if (src && src.startsWith('/') && !src.includes('error.svg')) {
                iigLog('INFO', `Fallback img click: src=${src.substring(0, 80)}`);
                e.preventDefault();
                e.stopPropagation();
                openFullscreenViewer(src);
                return;
            }
        }
    }, true); // CAPTURE phase — fires before any other handler
}

/**
 * Wrap a generated image element with action buttons (zoom, fullscreen, per-image regen).
 * Click handlers are NOT attached here — they use global event delegation instead.
 */
function wrapImageWithActions(mediaElement, tag, messageId, tagIndex, totalTags) {
    if (mediaElement.tagName !== 'IMG') return mediaElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper';
    wrapper.dataset.tagIndex = String(tagIndex);

    const actions = document.createElement('div');
    actions.className = 'iig-image-actions';

    // Fullscreen button — direct handler for reliability on mobile
    const fullscreenBtn = document.createElement('div');
    fullscreenBtn.className = 'iig-image-action-btn iig-fullscreen-btn';
    fullscreenBtn.title = 'На весь экран';
    fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    const _openFs = () => {
        // Get src from the actual img inside the wrapper at click time
        const curImg = wrapper.querySelector('img');
        const src = curImg?.src || mediaElement.src || '';
        console.log('[IIG] FS btn: src=', src.substring(0, 120));
        if (src) openFullscreenViewer(src);
    };
    fullscreenBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _openFs(); });
    fullscreenBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); _openFs(); });
    actions.appendChild(fullscreenBtn);

    // Per-image regeneration button — direct handler for reliability on mobile
    const regenBtn = document.createElement('div');
    regenBtn.className = 'iig-image-action-btn iig-regen-single-btn';
    regenBtn.title = 'Перегенерировать эту картинку';
    regenBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenBtn.dataset.messageId = String(messageId);
    regenBtn.dataset.tagIndex = String(tagIndex);
    regenBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleImage(messageId, tagIndex);
    });
    regenBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleImage(messageId, tagIndex);
    });
    actions.appendChild(regenBtn);

    wrapper.appendChild(actions);
    mediaElement.style.cursor = 'zoom-in';
    // Direct tap on image → fullscreen
    mediaElement.addEventListener('click', (e) => {
        if (e.target.closest('.iig-image-action-btn')) return;
        const curImg = wrapper.querySelector('img');
        const src = curImg?.src || mediaElement.src || '';
        if (src && !src.includes('error.svg')) {
            e.preventDefault();
            e.stopPropagation();
            openFullscreenViewer(src);
        }
    });
    wrapper.appendChild(mediaElement);
    return wrapper;
}

/**
 * Wrap an error image with ONLY a regen button (no fullscreen).
 */
function wrapErrorImageWithRegen(errorImg, messageId, tagIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper';
    wrapper.dataset.tagIndex = String(tagIndex);

    const actions = document.createElement('div');
    actions.className = 'iig-image-actions';

    const regenBtn = document.createElement('div');
    regenBtn.className = 'iig-image-action-btn iig-regen-single-btn';
    regenBtn.title = 'Перегенерировать эту картинку';
    regenBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenBtn.dataset.messageId = String(messageId);
    regenBtn.dataset.tagIndex = String(tagIndex);
    regenBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleImage(messageId, tagIndex);
    });
    regenBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        regenerateSingleImage(messageId, tagIndex);
    });
    actions.appendChild(regenBtn);

    wrapper.appendChild(actions);
    wrapper.appendChild(errorImg);
    return wrapper;
}

/**
 * Regenerate a single image in a message by tag index
 */
async function regenerateSingleImage(messageId, targetTagIndex) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    if (!message) {
        toastr.error('Сообщение не найдено', 'Генерация картинок');
        return;
    }

    const tags = await parseMessageImageTags(message, { forceAll: true });
    if (targetTagIndex < 0 || targetTagIndex >= tags.length) {
        toastr.error('Тег не найден', 'Генерация картинок');
        return;
    }

    const tag = tags[targetTagIndex];
    iigLog('INFO', `Regenerating single image ${targetTagIndex} in message ${messageId}`);
    toastr.info('Перегенерация 1 картинки...', 'Генерация картинок');

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement) return;
    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) return;

    const tagId = `iig-regen-single-${messageId}-${targetTagIndex}`;

    try {
        // Find the existing rendered media element by data-tag-index (reliable) or positional fallback
        let targetEl = mesTextEl.querySelector(`.iig-image-wrapper[data-tag-index="${targetTagIndex}"]`);
        if (!targetEl) {
            // Fallback: try bare media with instruction attribute at positional index
            const allBareMedia = Array.from(mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]'));
            targetEl = allBareMedia[targetTagIndex] || null;
        }
        if (!targetEl) {
            // Last resort: positional index among all wrappers
            const allWrappers = Array.from(mesTextEl.querySelectorAll('.iig-image-wrapper'));
            targetEl = allWrappers[targetTagIndex] || null;
        }
        if (!targetEl) {
            toastr.error('Элемент картинки не найден', 'Генерация картинок');
            return;
        }

        const instruction = targetEl.querySelector?.('img[data-iig-instruction]')?.getAttribute('data-iig-instruction')
            || targetEl.getAttribute?.('data-iig-instruction');

        const loadingPlaceholder = createLoadingPlaceholder(tagId);
        targetEl.replaceWith(loadingPlaceholder);

        const statusEl = loadingPlaceholder.querySelector('.iig-status');

        const generated = await generateImageWithRetry(
            tag.prompt,
            tag.style,
            (status) => { statusEl.textContent = status; },
            { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId }
        );

        let persistedSrc = '';
        if (isGeneratedVideoResult(generated)) {
            statusEl.textContent = 'Сохранение видео...';
            persistedSrc = await saveNaisteraMediaToFile(generated.dataUrl, 'video', { messageId, tagIndex: targetTagIndex, mode: 'regen-single-video', apiType: getSettings().apiType });
        } else {
            statusEl.textContent = 'Сохранение...';
            persistedSrc = await saveImageToFile(generated, { messageId, tagIndex: targetTagIndex, mode: 'regen-single', apiType: getSettings().apiType });
        }

        const mediaElement = createGeneratedMediaElement(
            isGeneratedVideoResult(generated)
                ? { ...generated, dataUrl: persistedSrc }
                : persistedSrc,
            tag,
        );
        if (instruction) {
            mediaElement.setAttribute('data-iig-instruction', instruction);
        }

        // Wrap with actions again
        const wrapped = wrapImageWithActions(mediaElement, tag, messageId, targetTagIndex, tags.length);
        loadingPlaceholder.replaceWith(wrapped);

        // Update message source
        const updatedTag = isGeneratedVideoResult(generated)
            ? buildPersistedVideoTag(tag.fullMatch, persistedSrc, '')
            : tag.fullMatch.replace(/src\s*=\s*(['"])[^'"]*\1/i, `src="${persistedSrc}"`);
        replaceTagInMessageSource(message, tag, updatedTag);

        await context.saveChat();
        toastr.success('Картинка перегенерирована', 'Генерация картинок', { timeOut: 2000 });
    } catch (error) {
        iigLog('ERROR', `Single image regeneration failed: ${error.message}`);
        toastr.error(`Ошибка: ${error.message}`, 'Генерация картинок');
    }
}

/**
 * Add zoom/fullscreen/regen buttons to already rendered images in a message
 */
function enhanceRenderedImages(mesTextEl, messageId) {
    // Match both freshly generated (.iig-generated-image) AND history images (img[data-iig-instruction] with valid src)
    // Also include error images (.iig-error-image) for regen button
    const images = Array.from(mesTextEl.querySelectorAll('img.iig-generated-image, img[data-iig-instruction], img.iig-error-image'));
    iigLog('INFO', `enhanceRenderedImages: messageId=${messageId}, found ${images.length} candidate images`);
    if (images.length === 0) return;

    // Deduplicate (an img might match both selectors)
    const seen = new Set();
    const unique = [];
    for (const img of images) {
        if (seen.has(img)) continue;
        seen.add(img);
        // Skip empty/marker src (but INCLUDE error images — they need regen button)
        const src = img.getAttribute('src') || '';
        if (src.includes('[IMG:') || !src) continue;
        unique.push(img);
    }
    if (unique.length === 0) return;

    iigLog('INFO', `enhanceRenderedImages: ${unique.length} valid images to wrap`);
    for (let i = 0; i < unique.length; i++) {
        const img = unique[i];
        // Skip if already wrapped
        if (img.closest('.iig-image-wrapper')) continue;

        const src = img.getAttribute('src') || '';
        iigLog('INFO', `  wrapping img[${i}]: src=${src.substring(0, 100)}, class=${img.className}, naturalWidth=${img.naturalWidth}, parent=${img.parentNode?.tagName}.${img.parentNode?.className}`);

        // Try to extract prompt/style from instruction attribute
        let prompt = img.alt || '';
        let style = '';
        const instruction = img.getAttribute('data-iig-instruction');
        if (instruction) {
            try {
                const decoded = instruction
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/&#34;/g, '"')
                    .replace(/&amp;/g, '&');
                const data = JSON.parse(decoded);
                prompt = data.prompt || prompt;
                style = data.style || style;
            } catch (_e) { /* ignore parse errors */ }
        }

        const tag = { prompt, style };
        // Insert a placeholder before the img (or its error wrapper), then build the new wrapper
        const errorWrapper = img.closest('.iig-error-wrapper');
        const anchorNode = errorWrapper || img;
        const placeholder = document.createComment('iig-enhance');
        anchorNode.parentNode.insertBefore(placeholder, anchorNode);
        if (errorWrapper) errorWrapper.remove(); // remove old error wrapper shell
        
        const isError = (img.getAttribute('src') || '').includes('error.svg');
        const wrapped = isError
            ? wrapErrorImageWithRegen(img, messageId, i)
            : wrapImageWithActions(img, tag, messageId, i, unique.length);
        placeholder.replaceWith(wrapped);
    }
}

/**
 * Initialize extension
 */
(function init() {
    const context = SillyTavern.getContext();
    
    // Debug: log available event types
    console.log('[IIG] Available event_types:', context.event_types);
    console.log('[IIG] CHARACTER_MESSAGE_RENDERED:', context.event_types.CHARACTER_MESSAGE_RENDERED);
    console.log('[IIG] MESSAGE_SWIPED:', context.event_types.MESSAGE_SWIPED);
    
    // Load settings
    getSettings();
    
    // Initialize global click handler (event delegation — survives DOM re-renders)
    initGlobalClickHandler();
    
    // Create settings UI when app is ready
    context.eventSource.on(context.event_types.APP_READY, () => {
        createSettingsUI();
        // Add buttons to any messages already in chat
        addButtonsToExistingMessages();
        console.log('[IIG] Inline Image Generation extension loaded');
    });
    
    // When chat is loaded/changed, add buttons to all existing messages
    context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
        iigLog('INFO', 'CHAT_CHANGED event - adding buttons to existing messages');
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            addButtonsToExistingMessages();
        }, 100);
    });
    
    // Wrapper to add debug logging
    const handleMessage = async (messageId) => {
        console.log('[IIG] Event triggered for message:', messageId);
        await onMessageReceived(messageId);
    };
    
    // Listen for new messages AFTER they're rendered in DOM
    // CHARACTER_MESSAGE_RENDERED fires after addOneMessage() completes
    context.eventSource.makeLast(context.event_types.CHARACTER_MESSAGE_RENDERED, handleMessage);
    
    // Re-add button after swipe (DOM is rebuilt, old button lost)
    context.eventSource.on(context.event_types.MESSAGE_SWIPED, (messageId) => {
        setTimeout(() => {
            const el = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
            if (!el) return;
            const msg = context.chat[messageId];
            if (msg && !msg.is_user) {
                addRegenerateButton(el, messageId);
                const mesText = el.querySelector('.mes_text');
                if (mesText) enhanceRenderedImages(mesText, messageId);
            }
        }, 100);
    });

    // Safety net: MutationObserver re-adds buttons if DOM is rebuilt for any reason
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const mesEls = node.classList?.contains('mes') ? [node] : node.querySelectorAll?.('.mes') || [];
                    for (const el of mesEls) {
                        const mesId = el.getAttribute('mesid');
                        if (mesId === null) continue;
                        const id = parseInt(mesId, 10);
                        const msg = context.chat[id];
                        if (msg && !msg.is_user && !el.querySelector('.iig-regenerate-btn')) {
                            addRegenerateButton(el, id);
                        }
                    }
                }
            }
        });
        observer.observe(chatEl, { childList: true, subtree: true });
    }
    
    console.log('[IIG] Inline Image Generation extension initialized');
})();
