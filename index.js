/**
 * SillyWardrobe — Outfit management extension for SillyTavern
 *
 * Adds a wardrobe button near the bot avatar. Separate outfit collections
 * for bot and user characters. Active outfit is per-chat and exposed as
 * a reference image for the sillyimages extension via window.sillyWardrobe.
 */

const MODULE_NAME = 'silly_wardrobe';

/* ───────────────── helpers ───────────────── */

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function swLog(level, ...args) {
    const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    fn('[SW]', ...args);
}

/* ───────────────── settings ───────────────── */

const defaultSettings = Object.freeze({
    wardrobes: {},       // { charName: { bot: [outfit…], user: [outfit…] } }
    maxDimension: 512,
    jpegQuality: 0.80,
});

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    for (const k of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, k)) s[k] = defaultSettings[k];
    }
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/* ───────────────── context helpers ───────────────── */

function getCharName() {
    const ctx = SillyTavern.getContext();
    if (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
        return ctx.characters[ctx.characterId].name || '';
    }
    return '';
}

function getChatId() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.getCurrentChatId === 'function') return ctx.getCurrentChatId() || '';
    // fallback: try chat_metadata
    return ctx.chat_metadata?.chat_id || '';
}

/* ───────────────── wardrobe data ───────────────── */

function getWardrobe(charName) {
    const s = getSettings();
    if (!s.wardrobes[charName]) {
        s.wardrobes[charName] = { bot: [], user: [] };
    }
    return s.wardrobes[charName];
}

function getActiveIds() {
    const ctx = SillyTavern.getContext();
    if (!ctx.chat_metadata) return { bot: null, user: null };
    return ctx.chat_metadata.wardrobe_active || { bot: null, user: null };
}

function setActiveId(type, outfitId) {
    const ctx = SillyTavern.getContext();
    if (!ctx.chat_metadata) return;
    if (!ctx.chat_metadata.wardrobe_active) {
        ctx.chat_metadata.wardrobe_active = { bot: null, user: null };
    }
    ctx.chat_metadata.wardrobe_active[type] = outfitId;
    if (typeof ctx.saveMetadata === 'function') {
        ctx.saveMetadata();
    }
}

function addOutfit(charName, type, outfit) {
    const w = getWardrobe(charName);
    w[type].push(outfit);
    saveSettings();
}

function removeOutfit(charName, type, outfitId) {
    const w = getWardrobe(charName);
    w[type] = w[type].filter(o => o.id !== outfitId);
    saveSettings();
    const a = getActiveIds();
    if (a[type] === outfitId) setActiveId(type, null);
}

function findOutfit(charName, type, id) {
    const w = getWardrobe(charName);
    return w[type].find(o => o.id === id) || null;
}

/* ───────────────── image processing ───────────────── */

function resizeImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const r = Math.min(maxDim / width, maxDim / height);
                    width = Math.round(width * r);
                    height = Math.round(height * r);
                }
                const c = document.createElement('canvas');
                c.width = width;
                c.height = height;
                c.getContext('2d').drawImage(img, 0, 0, width, height);
                const dataUrl = c.toDataURL('image/jpeg', quality);
                resolve({ base64: dataUrl.split(',')[1], dataUrl, width, height });
            };
            img.onerror = () => reject(new Error('Image decode failed'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

/* ───────────────── wardrobe button ───────────────── */

let modalOpen = false;

function injectWardrobeButton() {
    document.getElementById('sw-wardrobe-btn')?.remove();

    const charName = getCharName();
    if (!charName) return;

    const btn = document.createElement('div');
    btn.id = 'sw-wardrobe-btn';
    btn.className = 'sw-wardrobe-trigger interactable';
    btn.title = 'Гардероб';
    btn.innerHTML = '<i class="fa-solid fa-shirt"></i>';

    const active = getActiveIds();
    if (active.bot || active.user) btn.classList.add('sw-has-active');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        modalOpen ? closeModal() : openModal();
    });

    // Injection priority: avatar holder → top settings → form sheld
    const avatarHolder = document.querySelector('#avatar_img_holder');
    const topSettings = document.querySelector('#top-settings-holder');
    const formSheld = document.querySelector('#form_sheld');

    if (avatarHolder) {
        avatarHolder.style.position = 'relative';
        avatarHolder.appendChild(btn);
        btn.classList.add('sw-btn-overlay');
    } else if (topSettings) {
        topSettings.prepend(btn);
        btn.classList.add('sw-btn-inline');
    } else if (formSheld) {
        formSheld.prepend(btn);
        btn.classList.add('sw-btn-inline');
    }
}

function updateButtonBadge() {
    const btn = document.getElementById('sw-wardrobe-btn');
    if (!btn) return;
    const a = getActiveIds();
    btn.classList.toggle('sw-has-active', !!(a.bot || a.user));
}

/* ───────────────── modal ───────────────── */

let currentTab = 'bot';

function openModal() {
    closeModal();
    modalOpen = true;

    const charName = getCharName();
    if (!charName) {
        toastr.warning('Сначала выберите персонажа', 'Гардероб');
        modalOpen = false;
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'sw-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const modal = document.createElement('div');
    modal.id = 'sw-modal';
    modal.innerHTML = `
        <div class="sw-modal-header">
            <div class="sw-modal-title">
                <i class="fa-solid fa-shirt"></i>
                <span>Гардероб — <b>${charName}</b></span>
            </div>
            <div class="sw-modal-close interactable" title="Закрыть">
                <i class="fa-solid fa-xmark"></i>
            </div>
        </div>
        <div class="sw-tabs">
            <div class="sw-tab interactable ${currentTab === 'bot' ? 'sw-tab-active' : ''}" data-tab="bot">
                <i class="fa-solid fa-robot"></i> Бот
            </div>
            <div class="sw-tab interactable ${currentTab === 'user' ? 'sw-tab-active' : ''}" data-tab="user">
                <i class="fa-solid fa-user"></i> Юзер
            </div>
        </div>
        <div class="sw-active-info" id="sw-active-info"></div>
        <div class="sw-tab-content" id="sw-tab-content"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // header events
    modal.querySelector('.sw-modal-close').addEventListener('click', closeModal);
    for (const tab of modal.querySelectorAll('.sw-tab')) {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            modal.querySelectorAll('.sw-tab').forEach(t =>
                t.classList.toggle('sw-tab-active', t.dataset.tab === currentTab));
            renderTabContent();
        });
    }

    renderTabContent();
    document.addEventListener('keydown', onEsc);
}

function onEsc(e) { if (e.key === 'Escape') closeModal(); }

function closeModal() {
    modalOpen = false;
    document.getElementById('sw-modal-overlay')?.remove();
    document.removeEventListener('keydown', onEsc);
}

/* ───────────────── tab rendering ───────────────── */

function renderTabContent() {
    const container = document.getElementById('sw-tab-content');
    const infoBar = document.getElementById('sw-active-info');
    if (!container) return;

    const charName = getCharName();
    const wardrobe = getWardrobe(charName);
    const outfits = wardrobe[currentTab] || [];
    const active = getActiveIds();
    const activeId = active[currentTab];

    // Active outfit info bar
    if (infoBar) {
        const activeOutfit = activeId ? findOutfit(charName, currentTab, activeId) : null;
        if (activeOutfit) {
            infoBar.innerHTML = `
                <i class="fa-solid fa-check-circle"></i>
                Активно: <b>${sanitize(activeOutfit.name)}</b>
                ${activeOutfit.description ? ` — ${sanitize(activeOutfit.description)}` : ''}
            `;
            infoBar.classList.add('sw-active-visible');
        } else {
            infoBar.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Ничего не надето';
            infoBar.classList.remove('sw-active-visible');
        }
    }

    let html = '<div class="sw-outfit-grid">';

    // upload card
    html += `
        <div class="sw-outfit-card sw-upload-card interactable" id="sw-upload-trigger">
            <div class="sw-upload-icon"><i class="fa-solid fa-plus"></i></div>
            <span>Загрузить</span>
        </div>
    `;

    for (const o of outfits) {
        const isActive = o.id === activeId;
        html += `
            <div class="sw-outfit-card ${isActive ? 'sw-outfit-active' : ''}" data-id="${o.id}">
                <div class="sw-outfit-img-wrap">
                    <img src="data:image/jpeg;base64,${o.base64}" alt="${sanitize(o.name)}" class="sw-outfit-img" loading="lazy">
                    ${isActive ? '<div class="sw-active-badge"><i class="fa-solid fa-check"></i></div>' : ''}
                </div>
                <div class="sw-outfit-footer">
                    <span class="sw-outfit-name" title="${sanitize(o.description || o.name)}">${sanitize(o.name)}</span>
                    <div class="sw-outfit-btns">
                        <div class="sw-btn-activate interactable" title="${isActive ? 'Снять' : 'Надеть'}">
                            <i class="fa-solid ${isActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                        </div>
                        <div class="sw-btn-edit interactable" title="Редактировать">
                            <i class="fa-solid fa-pen"></i>
                        </div>
                        <div class="sw-btn-delete interactable" title="Удалить">
                            <i class="fa-solid fa-trash-can"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;

    // events
    document.getElementById('sw-upload-trigger')?.addEventListener('click', handleUpload);

    for (const card of container.querySelectorAll('.sw-outfit-card[data-id]')) {
        const id = card.dataset.id;

        // click image → toggle active
        card.querySelector('.sw-outfit-img')?.addEventListener('click', () => {
            toggleActive(id);
        });

        card.querySelector('.sw-btn-activate')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleActive(id);
        });

        card.querySelector('.sw-btn-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            handleEdit(charName, currentTab, id);
        });

        card.querySelector('.sw-btn-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить этот аутфит?')) {
                removeOutfit(charName, currentTab, id);
                renderTabContent();
                updateButtonBadge();
                toastr.info('Аутфит удалён', 'Гардероб');
            }
        });
    }
}

function toggleActive(id) {
    const a = getActiveIds();
    setActiveId(currentTab, a[currentTab] === id ? null : id);
    renderTabContent();
    updateButtonBadge();
}

function sanitize(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
}

/* ───────────────── upload ───────────────── */

async function handleUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;

        // show mini-dialog inside modal
        const name = prompt('Название аутфита:', file.name.replace(/\.[^.]+$/, ''));
        if (name === null || !name.trim()) return;

        const description = prompt('Описание (опционально, для контекста):', '') || '';

        try {
            const s = getSettings();
            const { base64 } = await resizeImage(file, s.maxDimension, s.jpegQuality);

            const outfit = {
                id: uid(),
                name: name.trim(),
                description: description.trim(),
                base64,
                addedAt: Date.now(),
            };

            const charName = getCharName();
            addOutfit(charName, currentTab, outfit);
            renderTabContent();
            toastr.success(`«${name.trim()}» добавлен`, 'Гардероб');
        } catch (err) {
            swLog('ERROR', 'Upload failed:', err);
            toastr.error('Ошибка загрузки: ' + err.message, 'Гардероб');
        }
    });

    input.click();
}

/* ───────────────── edit ───────────────── */

function handleEdit(charName, type, id) {
    const outfit = findOutfit(charName, type, id);
    if (!outfit) return;

    const newName = prompt('Название:', outfit.name);
    if (newName === null) return;

    const newDesc = prompt('Описание:', outfit.description || '');
    if (newDesc === null) return;

    outfit.name = newName.trim() || outfit.name;
    outfit.description = newDesc.trim();
    saveSettings();
    renderTabContent();
    toastr.info('Аутфит обновлён', 'Гардероб');
}

/* ───────────────── public API for sillyimages ───────────────── */

window.sillyWardrobe = {
    /**
     * Get active outfit base64 string (no data: prefix) for image reference.
     * @param {'bot'|'user'} type
     * @returns {string|null} Pure base64 JPEG
     */
    getActiveOutfitBase64(type) {
        const charName = getCharName();
        if (!charName) return null;
        const a = getActiveIds();
        if (!a[type]) return null;
        return findOutfit(charName, type, a[type])?.base64 || null;
    },

    /**
     * Get active outfit as data URL for providers that need it (Naistera).
     * @param {'bot'|'user'} type
     * @returns {string|null} data:image/jpeg;base64,...
     */
    getActiveOutfitDataUrl(type) {
        const b64 = this.getActiveOutfitBase64(type);
        return b64 ? `data:image/jpeg;base64,${b64}` : null;
    },

    /**
     * Get full outfit object { id, name, description, base64, addedAt }.
     * @param {'bot'|'user'} type
     * @returns {object|null}
     */
    getActiveOutfitData(type) {
        const charName = getCharName();
        if (!charName) return null;
        const a = getActiveIds();
        if (!a[type]) return null;
        return findOutfit(charName, type, a[type]);
    },

    /** Check if extension is loaded. */
    isReady: () => true,
};

/* ───────────────── settings panel ───────────────── */

function createSettingsUI() {
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    const s = getSettings();

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-shirt"></i> Гардероб</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="sw-settings">
                    <p class="sw-hint">
                        Управляйте аутфитами через кнопку <i class="fa-solid fa-shirt"></i> рядом с аватаром.
                        Активный аутфит отправляется как reference-изображение при генерации картинок
                        (требуется sillyimages с интеграцией).
                    </p>
                    <hr>
                    <div class="sw-settings-row">
                        <label for="sw_max_dim">Макс. размер (px)</label>
                        <input type="number" id="sw_max_dim" class="text_pole" value="${s.maxDimension}" min="128" max="1024" step="64">
                    </div>
                    <div class="sw-settings-row">
                        <label for="sw_quality">Качество JPEG</label>
                        <input type="range" id="sw_quality" min="0.3" max="1.0" step="0.05" value="${s.jpegQuality}">
                        <span id="sw_quality_val">${s.jpegQuality}</span>
                    </div>
                    <hr>
                    <div class="sw-settings-row">
                        <label>Очистить все аутфиты</label>
                        <div id="sw_clear_all" class="menu_button menu_button_icon" title="Удалить ВСЕ аутфиты для ВСЕХ персонажей">
                            <i class="fa-solid fa-trash-can"></i> Очистить
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);

    document.getElementById('sw_max_dim')?.addEventListener('change', (e) => {
        getSettings().maxDimension = Math.max(128, Math.min(1024, parseInt(e.target.value) || 512));
        saveSettings();
    });

    document.getElementById('sw_quality')?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        getSettings().jpegQuality = v;
        document.getElementById('sw_quality_val').textContent = v.toFixed(2);
        saveSettings();
    });

    document.getElementById('sw_clear_all')?.addEventListener('click', () => {
        if (confirm('Удалить ВСЕ аутфиты для всех персонажей? Это действие нельзя отменить.')) {
            getSettings().wardrobes = {};
            saveSettings();
            toastr.info('Все аутфиты удалены', 'Гардероб');
        }
    });
}

/* ───────────────── init ───────────────── */

(function init() {
    const ctx = SillyTavern.getContext();
    getSettings();

    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        createSettingsUI();
        injectWardrobeButton();
        swLog('INFO', 'SillyWardrobe loaded');
    });

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            injectWardrobeButton();
        }, 150);
    });

    swLog('INFO', 'SillyWardrobe initialized');
})();
