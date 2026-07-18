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
    function swLog(l, ...a) { if (l === 'ERROR') return console.error('[SW]', ...a); if (l === 'WARN') return console.warn('[SW]', ...a); if (window.IIG_DEBUG) console.log('[SW]', ...a); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

    // Strip <think>...</think> reasoning blocks and similar fences from outfit descriptions.
    function swSanitizeDesc(raw) {
        let s = String(raw || '');
        s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
        s = s.replace(/<\/?think\b[^>]*>/gi, '');
        s = s.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '');
        s = s.replace(/\[(?:thinking|thought|reasoning)\][\s\S]*?\[\/(?:thinking|thought|reasoning)\]/gi, '');
        return s.replace(/\s+/g, ' ').trim();
    }

    const swDefaults = Object.freeze({
        wardrobes: {}, activeOutfits: {},
        // Общий (глобальный) гардероб юзера — единый для всех персонажей.
        // Картинки хранятся ФАЙЛАМИ (imagePath), а НЕ base64 — чтобы не раздувать settings.json.
        // Общий гардероб (общая коллекция на всех персонажей; надетое — per-chat).
        // *Active — глобальный фолбэк (когда нет открытого чата); *ActiveByChat — что надето в каждом чате: { [chatId]: outfitId }.
        sharedUserWardrobe: [], sharedUserActive: null, sharedUserActiveByChat: {}, useSharedUserWardrobe: false,
        sharedBotWardrobe:  [], sharedBotActive:  null, sharedBotActiveByChat:  {}, useSharedBotWardrobe:  false,
        maxDimension: 512, showFloatingBtn: false,
        // Где живёт кнопка-гардероб: 'bar' — в строке ввода, 'float' — плавающая поверх чата,
        // 'wand' — спрятана в меню «волшебной палочки» (#extensionsMenu), без иконки в чате.
        btnPlacement: 'bar',
        // Шаблон промта примерки (try-on). Пусто = использовать SW_DEFAULT_TRYON_PROMPT.
        // Редактируется юзером в «Быстрых настройках». Плейсхолдеры см. в swBuildTryOnPrompt.
        tryOnPrompt: '',
        // Шаблон промта генерации образа ПО ОПИСАНИЮ (без картинки наряда, референс — только аватар).
        // Пусто = использовать SW_DEFAULT_GENLOOK_PROMPT.
        genLookPrompt: '',
        // Образ-примерка (картинка = человек уже В наряде) при генерации уходит как
        // аватар-референс вместо пары «аватар + наряд»: ИИ не путает чужую одежду,
        // и тратится один слот референсов вместо двух.
        tryOnAsAvatar: true,
    });

    function swGetSettings() {
        const ctx = SillyTavern.getContext();
        if (!ctx.extensionSettings[SW]) ctx.extensionSettings[SW] = structuredClone(swDefaults);
        const s = ctx.extensionSettings[SW];
        // structuredClone, чтобы не присвоить общую ссылку на замороженный дефолтный массив/объект.
        for (const k of Object.keys(swDefaults)) if (!Object.hasOwn(s, k)) s[k] = structuredClone(swDefaults[k]);
        // Защита от повреждённых настроек.
        if (!Array.isArray(s.sharedUserWardrobe)) s.sharedUserWardrobe = [];
        if (!Array.isArray(s.sharedBotWardrobe)) s.sharedBotWardrobe = [];
        if (!s.sharedUserActiveByChat || typeof s.sharedUserActiveByChat !== 'object') s.sharedUserActiveByChat = {};
        if (!s.sharedBotActiveByChat || typeof s.sharedBotActiveByChat !== 'object') s.sharedBotActiveByChat = {};
        // ── Типы одежды: засев из дефолтов при первом запуске + разовая миграция ──
        if (!Array.isArray(s.outfitTypes) || !s.outfitTypes.length) {
            s.outfitTypes = structuredClone(SW_DEFAULT_TYPES);
            // Старый id 'underwear' был ошибочно подписан «Работа» — переносим на нормальный 'work'.
            swMigrateTypeId(s, 'underwear', 'work');
        }
        // Чистка повреждённых записей + гарантия запасного тега 'other'.
        // swGetSettings зовётся часто — пересобираем массив только если реально есть мусор.
        if (s.outfitTypes.some(t => !t || typeof t.id !== 'string' || !t.id)) {
            s.outfitTypes = s.outfitTypes.filter(t => t && typeof t.id === 'string' && t.id);
        }
        if (!s.outfitTypes.some(t => t.id === SW_FALLBACK_TYPE)) s.outfitTypes.push({ id: SW_FALLBACK_TYPE, label: 'Другое', icon: 'fa-tag' });
        return s;
    }

    // ── Типы одежды (категории) ──
    // Дефолтный набор — «семя» при первом запуске. Дальше список редактируется
    // пользователем и хранится в settings.outfitTypes (см. swGetSettings / swTypes).
    const SW_DEFAULT_TYPES = [
        { id: 'casual', label: 'Повседневное',   icon: 'fa-shirt' },
        { id: 'formal', label: 'Формальное',     icon: 'fa-gem' },
        { id: 'sport',  label: 'Спортивное',     icon: 'fa-person-running' },
        { id: 'sleep',  label: 'Спальное',       icon: 'fa-bed' },
        { id: 'beach',  label: 'Пляж/купальник', icon: 'fa-umbrella-beach' },
        { id: 'work',   label: 'Работа',         icon: 'fa-briefcase' },
        { id: 'outer',  label: 'Верхняя',        icon: 'fa-mitten' },
        { id: 'other',  label: 'Другое',         icon: 'fa-tag' },
    ];
    // Запасной тег: всегда существует и не удаляется — сюда уходят наряды удалённых тегов.
    const SW_FALLBACK_TYPE = 'other';
    // Набор иконок для выбора при создании/редактировании тега.
    const SW_TYPE_ICONS = [
        'fa-shirt', 'fa-gem', 'fa-person-running', 'fa-bed', 'fa-umbrella-beach',
        'fa-briefcase', 'fa-mitten', 'fa-tag', 'fa-crown', 'fa-hat-cowboy',
        'fa-vest', 'fa-socks', 'fa-shoe-prints', 'fa-glasses', 'fa-ring',
        'fa-user-tie', 'fa-user-ninja', 'fa-mask', 'fa-snowflake', 'fa-sun',
        'fa-heart', 'fa-star', 'fa-wand-magic-sparkles', 'fa-dragon',
    ];

    // Эффективный список типов из настроек (с гарантией запасного тега 'other').
    function swTypes() { return swGetSettings().outfitTypes; }
    function swTypeIds() { return swTypes().map(t => t.id); }
    function swTypeOf(o) { return (o && swTypeIds().includes(o.type)) ? o.type : SW_FALLBACK_TYPE; }
    function swTypeMeta(id) { const ts = swTypes(); return ts.find(t => t.id === id) || ts.find(t => t.id === SW_FALLBACK_TYPE) || ts[ts.length - 1]; }

    // Обойти все наряды во всех гардеробах (персональные + общие).
    function swForEachOutfit(s, cb) {
        const arrays = [s.sharedBotWardrobe, s.sharedUserWardrobe];
        for (const w of Object.values(s.wardrobes || {})) if (w) arrays.push(w.bot, w.user);
        for (const arr of arrays) if (Array.isArray(arr)) for (const o of arr) if (o) cb(o);
    }
    // Переписать тип у всех нарядов: oldId → newId.
    function swMigrateTypeId(s, oldId, newId) { swForEachOutfit(s, (o) => { if (o.type === oldId) o.type = newId; }); }

    // Рендер менеджера тегов одежды (в «Быстрых настройках»). Перерисовывает себя при структурных изменениях.
    function swRenderTagManager(listEl) {
        if (!listEl) return;
        const types = swTypes();
        listEl.innerHTML = types.map(t => {
            const locked = t.id === SW_FALLBACK_TYPE;
            const icons = SW_TYPE_ICONS.map(ic => `<button type="button" class="sw-tag-ico-opt ${ic === t.icon ? 'sw-tag-ico-sel' : ''}" data-ico="${ic}" title="${ic}"><i class="fa-solid ${ic}"></i></button>`).join('');
            return `<div class="sw-tag-block">
                <div class="sw-tag-row" data-id="${esc(t.id)}">
                    <button type="button" class="sw-tag-icon" title="Сменить иконку"><i class="fa-solid ${esc(t.icon || 'fa-tag')}"></i></button>
                    <input type="text" class="sw-tag-name text_pole" value="${esc(t.label || '')}" maxlength="24" placeholder="Название тега">
                    ${locked
                        ? '<span class="sw-tag-lock" title="Запасной тег — удалить нельзя"><i class="fa-solid fa-lock"></i></span>'
                        : '<button type="button" class="sw-tag-del" title="Удалить тег"><i class="fa-solid fa-trash-can"></i></button>'}
                </div>
                <div class="sw-tag-icons" hidden>${icons}</div>
            </div>`;
        }).join('');

        const refreshMain = () => { if (swOpen) swRender(); };

        for (const block of listEl.querySelectorAll('.sw-tag-block')) {
            const row = block.querySelector('.sw-tag-row');
            const id = row.dataset.id;
            const iconsBox = block.querySelector('.sw-tag-icons');
            const tag = () => swTypes().find(x => x.id === id);

            // Открыть/закрыть палитру иконок (по одной за раз).
            row.querySelector('.sw-tag-icon').addEventListener('click', () => {
                const willShow = iconsBox.hidden;
                for (const b of listEl.querySelectorAll('.sw-tag-icons')) b.hidden = true;
                iconsBox.hidden = !willShow;
            });
            for (const opt of iconsBox.querySelectorAll('.sw-tag-ico-opt')) {
                opt.addEventListener('click', () => {
                    const t = tag(); if (!t) return;
                    t.icon = opt.dataset.ico; swSave();
                    swRenderTagManager(listEl); refreshMain();
                });
            }

            // Переименование: на input сохраняем без перерисовки (не теряем фокус), на blur — нормализуем.
            const nameInp = row.querySelector('.sw-tag-name');
            nameInp.addEventListener('input', () => { const t = tag(); if (t) { t.label = nameInp.value; swSave(); } });
            nameInp.addEventListener('change', () => {
                const t = tag(); if (!t) return;
                t.label = nameInp.value.trim() || t.label || 'Тег';
                nameInp.value = t.label; swSave(); refreshMain();
            });

            // Удаление: наряды тега молча уходят в «Другое» (запасной тег).
            row.querySelector('.sw-tag-del')?.addEventListener('click', () => {
                const s = swGetSettings();
                let moved = 0;
                swForEachOutfit(s, (o) => { if (o.type === id) { o.type = SW_FALLBACK_TYPE; moved++; } });
                s.outfitTypes = s.outfitTypes.filter(x => x.id !== id);
                if (swFilter === id) swFilter = 'all';
                swSave();
                swRenderTagManager(listEl); refreshMain();
                toastr.info(`Тег удалён${moved ? ` · ${moved} ${swPlural(moved, 'наряд', 'наряда', 'нарядов')} → «Другое»` : ''}`, 'Гардероб', { timeOut: 2500 });
            });
        }
    }

    // Русское склонение для счётчиков (1 наряд / 2 наряда / 5 нарядов).
    function swPlural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
        return many;
    }

    // Источник картинки для <img>: файл (общий гардероб) или inline base64 (per-char).
    function swImgSrc(o) {
        if (!o) return '';
        if (o.imagePath) return o.imagePath;
        if (o.base64) return 'data:image/png;base64,' + o.base64;
        return '';
    }

    // Текущий фильтр по типу (UI-состояние модалки).
    let swFilter = 'all';
    // Сортировка карточек: 'added' (сначала новые) | 'worn' (недавно надетые) | 'name' (по имени).
    let swSort = 'added';
    // Пагинация: сколько НАРЯДОВ на странице. 10 + карточки «Загрузить» и «Сгенерировать» = 12 ячеек —
    // ровно делится на 2/3/4/6 столбцов, поэтому сетка не оставляет дыр в последнем ряду.
    const SW_PAGE_SIZE = 10;
    let swPage = 0;

    // Сортировка списка нарядов (возвращает новый отсортированный массив, исходный не мутируем).
    // activeId — надетый образ всегда выносим самым первым, независимо от выбранной сортировки.
    function swSortOutfits(arr, activeId) {
        const a = arr.slice();
        if (swSort === 'name') {
            a.sort((x, y) => (x.name || '').localeCompare(y.name || '', undefined, { sensitivity: 'base', numeric: true }));
        } else if (swSort === 'worn') {
            // Недавно надетые сверху; никогда не надетые падают вниз и упорядочиваются по дате добавления.
            a.sort((x, y) => (y.lastWorn || 0) - (x.lastWorn || 0) || (y.addedAt || 0) - (x.addedAt || 0));
        } else {
            // 'added' (по умолчанию): сначала новые.
            a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
        }
        // Закрепляем надетый образ на первом месте.
        if (activeId) {
            const i = a.findIndex(o => o.id === activeId);
            if (i > 0) a.unshift(a.splice(i, 1)[0]);
        }
        return a;
    }

    // Кэш base64 активного образа общего гардероба ПО СТОРОНЕ ('bot'|'user') — ленивая загрузка из файла.
    // В памяти держим только активный образ каждой стороны, не весь гардероб — ключ к производительности.
    const swSharedCache = { bot: { b64: null, id: null }, user: { b64: null, id: null } };
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

    // ── Конфиг общего гардероба ПО СТОРОНЕ ('bot' | 'user') ──
    // Коллекция общая для всех персонажей; что именно надето — своё в каждом чате (per-chat).
    function swSharedCfg(side) {
        const s = swGetSettings();
        const k = side === 'bot'
            ? { list: 'sharedBotWardrobe',  active: 'sharedBotActive',  byChat: 'sharedBotActiveByChat',  use: 'useSharedBotWardrobe' }
            : { list: 'sharedUserWardrobe', active: 'sharedUserActive', byChat: 'sharedUserActiveByChat', use: 'useSharedUserWardrobe' };
        return {
            use: () => !!s[k.use],
            setUse: (v) => { s[k.use] = !!v; },
            list: () => s[k.list],
            setList: (arr) => { s[k.list] = arr; },
            global: () => s[k.active] || null,
            setGlobal: (id) => { s[k.active] = id; },
            byChat: () => s[k.byChat],
            fileLabel: () => (side === 'bot' ? 'sw_bot_' : 'sw_user_'),
        };
    }

    function swCurrentChatId() {
        try {
            const ctx = SillyTavern.getContext();
            return (typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null) || null;
        } catch (e) { return null; }
    }
    function swGetSharedActiveId(side) {
        const cfg = swSharedCfg(side);
        const cid = swCurrentChatId();
        if (cid) { const m = cfg.byChat(); return Object.hasOwn(m, cid) ? m[cid] : null; }
        return cfg.global(); // нет открытого чата → глобальный фолбэк
    }
    function swSetSharedActiveId(side, id) {
        const cfg = swSharedCfg(side);
        const cid = swCurrentChatId();
        if (cid) { const m = cfg.byChat(); if (id == null) delete m[cid]; else m[cid] = id; }
        else cfg.setGlobal(id);
        swSave();
    }

    // ── Активный образ стороны с учётом режима (Общий / Персональный) ──
    function swGetActiveSideOutfit(side) {
        const cfg = swSharedCfg(side);
        if (cfg.use()) {
            const id = swGetSharedActiveId(side);
            return id ? (cfg.list().find(o => o.id === id) || null) : null;
        }
        const cn = swCharName(); if (!cn) return null;
        const a = swGetActive(); return a[side] ? swFind(cn, side, a[side]) : null;
    }
    function swGetActiveBotOutfit()  { return swGetActiveSideOutfit('bot'); }
    function swGetActiveUserOutfit() { return swGetActiveSideOutfit('user'); }

    // Единая абстракция «вид гардероба» для текущего таба: общий (файловый) ИЛИ per-character.
    function swCurrentView() {
        const cfg = swSharedCfg(swTab);
        if (cfg.use()) {
            return {
                shared: true, side: swTab,
                list: () => cfg.list(),
                activeId: () => swGetSharedActiveId(swTab),          // что надето в ЭТОМ чате
                setActive: (id) => { swSetSharedActiveId(swTab, id); return true; },
                find: (id) => cfg.list().find(o => o.id === id) || null,
                add: (o) => { cfg.list().push(o); swSave(); },
                remove: (id) => {
                    cfg.setList(cfg.list().filter(o => o.id !== id));
                    if (cfg.global() === id) cfg.setGlobal(null);
                    // снять удалённый образ во всех чатах, где он был надет
                    const m = cfg.byChat(); for (const key of Object.keys(m)) if (m[key] === id) delete m[key];
                    swSave();
                },
            };
        }
        const cn = swCharName();
        return {
            shared: false, side: swTab,
            list: () => swGetWardrobe(cn)[swTab],
            activeId: () => swGetActive()[swTab],
            setActive: (id) => swSetActive(swTab, id),
            find: (id) => swFind(cn, swTab, id),
            add: (o) => swAdd(cn, swTab, o),
            remove: (id) => swRemove(cn, swTab, id),
        };
    }

    // Ленивая предзагрузка base64 активного образа общего гардероба (по стороне).
    // В памяти — только активный образ каждой стороны. Никогда не бросает исключений.
    async function swPreloadSharedActive(side) {
        try {
            const cfg = swSharedCfg(side);
            const c = swSharedCache[side];
            const id = cfg.use() ? swGetSharedActiveId(side) : null; // активный образ ЭТОГО чата
            if (!id) { c.b64 = null; c.id = null; return; }
            if (c.id === id && c.b64) return; // уже в кэше
            const o = cfg.list().find(x => x.id === id);
            if (!o) { c.b64 = null; c.id = null; return; }
            let b64 = o.base64 || null; // fallback, если файл не сохранился
            if (!b64 && o.imagePath && typeof loadRefImageAsBase64 === 'function') b64 = await loadRefImageAsBase64(o.imagePath);
            c.b64 = b64; c.id = b64 ? id : null;
        } catch (e) {
            swLog('WARN', `preload shared active (${side}) failed:`, e.message);
            const c = swSharedCache[side]; c.b64 = null; c.id = null;
        }
    }
    function swPreloadAllShared() { swPreloadSharedActive('bot'); swPreloadSharedActive('user'); }

    // ── Миграция: перенос старых per-character нарядов в ОБЩИЙ гардероб (по стороне) ──
    // Создаёт КОПИИ (как файлы), оригиналы НЕ трогает. Идемпотентно (по srcId).
    function swSharedHasSrc(side, srcId) {
        return swSharedCfg(side).list().some(x => x.srcId === srcId);
    }
    function swCollectPendingOutfits(side) {
        const s = swGetSettings();
        const out = [];
        for (const w of Object.values(s.wardrobes || {})) {
            if (!w || !Array.isArray(w[side])) continue;
            for (const o of w[side]) if ((o.base64 || o.imagePath) && !swSharedHasSrc(side, o.id)) out.push(o);
        }
        return out;
    }
    function swCountPendingMigration(side) { return swCollectPendingOutfits(side).length; }

    // Авто-надеть в общем гардеробе копию того, что было одето у ТЕКУЩЕГО персонажа (по стороне).
    // force=true — даже если в общем уже что-то активно (используется при миграции: переносим текущее состояние).
    function swAutoWearSharedFromCurrent(side, { force = false } = {}) {
        const s = swGetSettings();
        const cn = swCharName(); if (!cn) return null;
        const wornId = s.activeOutfits?.[cn]?.[side];
        if (!wornId) return null;                              // ничего не было одето
        if (!force && swGetSharedActiveId(side)) return null;  // не клоберим уже выбранный в этом чате
        const copy = swSharedCfg(side).list().find(x => x.srcId === wornId);
        if (!copy) return null;                                // копии в общем нет
        swSetSharedActiveId(side, copy.id);                    // надеваем в ТЕКУЩЕМ чате
        swPreloadSharedActive(side);
        return copy.name || 'образ';
    }

    async function swMigrateToShared(side) {
        const s = swGetSettings();
        const cfg = swSharedCfg(side);
        const pending = swCollectPendingOutfits(side);
        if (!pending.length) { toastr.info('Все старые наряды уже в общем гардеробе', 'Гардероб'); return 0; }
        toastr.info(`Импорт ${pending.length} нарядов… разовая операция`, 'Гардероб', { timeOut: 4000 });
        let done = 0, failed = 0;
        // Последовательно (не параллельно) — чтобы не нагружать сервер залпом загрузок.
        for (const o of pending) {
            try {
                const item = { id: uid(), srcId: o.id, name: o.name || 'Без имени', description: o.description || '', type: swTypeOf(o), addedAt: o.addedAt || Date.now() };
                if (o.tryOnSide) item.tryOnSide = o.tryOnSide; // примерка остаётся примеркой

                let stored = false;
                if (o.imagePath && !o.base64) {
                    item.imagePath = o.imagePath; stored = true; // уже файл — просто ссылаемся
                } else if (o.base64 && typeof compressBase64Image === 'function' && typeof saveRefImageToFile === 'function') {
                    try {
                        const jpeg = await compressBase64Image(o.base64, s.maxDimension, 0.82);
                        item.imagePath = await saveRefImageToFile(jpeg, cfg.fileLabel() + (o.name || 'item'));
                        stored = true;
                    } catch (err) { swLog('WARN', 'migrate file store failed, fallback base64:', err.message); }
                }
                if (!stored) item.base64 = o.base64 || '';
                cfg.list().push(item);
                done++;
                if (done % 5 === 0) swSave(); // периодически сохраняем прогресс
            } catch (e) { failed++; swLog('WARN', 'migrate item failed:', e.message); }
        }
        swSave();
        // Если у текущего персонажа что-то было одето — автоматически надеваем перенесённую копию.
        const worn = swAutoWearSharedFromCurrent(side, { force: true });
        swPreloadSharedActive(side);
        toastr.success(`Импортировано: ${done}${failed ? `, не удалось: ${failed}` : ''}.${worn ? ` Надет: «${worn}».` : ''} Оригиналы на месте.`, 'Гардероб', { timeOut: 5000 });
        return done;
    }

    // dataURL → resized PNG base64 (файл читается заранее — между чтением и сжатием встаёт кадрирование).
    function swResize(dataUrl, maxDim) {
        return new Promise((res, rej) => {
            const img = new Image(); img.onload = () => { let { width: w, height: h } = img; if (w > maxDim || h > maxDim) { const s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ base64: c.toDataURL('image/png').split(',')[1] }); }; img.onerror = () => rej(new Error('decode')); img.src = dataUrl;
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
                <span class="sw-modal-title">Гардероб — <b>${esc(cn)}</b></span>
                <div class="sw-modal-header-btns">
                    <div class="sw-header-btn sw-btn-npc" title="Менеджер NPC"><i class="fa-solid fa-users"></i></div>
                    <div class="sw-header-btn sw-btn-maint" title="Обслуживание: дубликаты и чистка файлов"><i class="fa-solid fa-broom"></i></div>
                    <div class="sw-header-btn sw-btn-quick" title="Быстрые настройки"><i class="fa-solid fa-sliders"></i></div>
                    <div class="sw-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
                </div>
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
        m.querySelector('.sw-btn-quick').addEventListener('click', swOpenQuickSettings);
        m.querySelector('.sw-btn-npc').addEventListener('click', swOpenNpcManager);
        m.querySelector('.sw-btn-maint').addEventListener('click', () => swOpenMaintenance('dedup'));
        for (const t of m.querySelectorAll('.sw-tab')) t.addEventListener('click', () => {
            swTab = t.dataset.tab; swFilter = 'all'; swPage = 0;
            m.querySelectorAll('.sw-tab').forEach(x => x.classList.toggle('sw-tab-active', x.dataset.tab === swTab)); swRender();
        });
        swFilter = 'all'; swPage = 0;
        swRender();
        document.addEventListener('keydown', swEsc);
    }

    function swEsc(e) { if (e.key === 'Escape') swCloseModal(); }
    function swCloseModal() { swOpen = false; document.getElementById('sw-modal-overlay')?.remove(); document.removeEventListener('keydown', swEsc); }

    function swRender() {
        const c = document.getElementById('sw-tab-content'), ib = document.getElementById('sw-active-info');
        if (!c) return;
        const v = swCurrentView();
        const outfits = v.list() || [], aid = v.activeId();

        if (ib) {
            const ao = aid ? v.find(aid) : null;
            const aoDesc = ao ? swSanitizeDesc(ao.description) : '';
            ib.innerHTML = ao ? `Активно: <b>${esc(ao.name)}</b>${aoDesc ? ` — <i>${esc(aoDesc.length > 60 ? aoDesc.slice(0, 60) + '...' : aoDesc)}</i>` : ''}` : 'Ничего не надето';
            ib.classList.toggle('sw-active-visible', !!ao);
        }

        let h = '';

        // ── Кнопки режима: Перс / Общий (для обоих табов — Бот и Юзер) ──
        {
            const useShared = v.shared;
            const sortOpt = (val, label) => `<option value="${val}" ${swSort === val ? 'selected' : ''}>${label}</option>`;
            h += `<div class="sw-mode-row">
                <div class="sw-mode-btn ${!useShared ? 'sw-mode-active' : ''}" data-mode="perc"><i class="fa-solid fa-user"></i> Перс</div>
                <div class="sw-mode-btn ${useShared ? 'sw-mode-active' : ''}" data-mode="shared"><i class="fa-solid fa-earth-americas"></i> Общий</div>
                <div class="sw-sort-wrap" title="Сортировка">
                    <i class="fa-solid fa-arrow-down-wide-short"></i>
                    <select class="sw-sort-select">${sortOpt('added', 'Недавно добавленные')}${sortOpt('worn', 'Недавно надетые')}${sortOpt('name', 'По имени')}</select>
                </div>
            </div>`;
        }

        // ── Фильтр по типам (виды одежды) ──
        const counts = {};
        for (const o of outfits) { const t = swTypeOf(o); counts[t] = (counts[t] || 0) + 1; }
        // Если активный фильтр опустел — сбрасываем на «Все».
        if (swFilter !== 'all' && !counts[swFilter]) swFilter = 'all';
        h += `<div class="sw-filter-row"><div class="sw-filter-chip ${swFilter === 'all' ? 'sw-filter-active' : ''}" data-type="all">Все <span class="sw-chip-count">${outfits.length}</span></div>`;
        for (const t of swTypes()) {
            if (!counts[t.id]) continue;
            h += `<div class="sw-filter-chip ${swFilter === t.id ? 'sw-filter-active' : ''}" data-type="${t.id}"><i class="fa-solid ${t.icon}"></i> ${esc(t.label)} <span class="sw-chip-count">${counts[t.id]}</span></div>`;
        }
        h += '</div>';

        const filtered = swFilter === 'all' ? outfits : outfits.filter(o => swTypeOf(o) === swFilter);
        const shown = swSortOutfits(filtered, aid);

        // ── Пагинация: рендерим только текущую страницу (меньше DOM-узлов и одновременно грузящихся картинок) ──
        const totalPages = Math.max(1, Math.ceil(shown.length / SW_PAGE_SIZE));
        if (swPage > totalPages - 1) swPage = totalPages - 1;
        if (swPage < 0) swPage = 0;
        const pageItems = shown.slice(swPage * SW_PAGE_SIZE, (swPage + 1) * SW_PAGE_SIZE);

        h += '<div class="sw-outfit-grid"><div class="sw-outfit-card sw-upload-card" id="sw-upload-trigger"><div class="sw-upload-icon"><i class="fa-solid fa-plus"></i></div><span>Загрузить</span></div>'
           + '<div class="sw-outfit-card sw-upload-card" id="sw-gen-trigger" title="Сгенерировать образ по текстовому описанию (ИИ): референсом уходит только аватар, результат сохраняется как примерка"><div class="sw-upload-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div><span>Сгенерировать</span></div>';
        for (const o of pageItems) {
            const a = o.id === aid;
            const oDesc = swSanitizeDesc(o.description);
            const tm = swTypeMeta(swTypeOf(o));
            const opts = swTypes().map(t => `<option value="${t.id}" ${swTypeOf(o) === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
            const tryOnBadge = o.tryOnSide ? `<div class="sw-tryon-badge" title="Примерка (${o.tryOnSide === 'bot' ? 'на персонажа' : 'на персону'}): при генерации уходит как аватар-референс — человек уже в наряде"><i class="fa-solid fa-person-rays"></i></div>` : '';
            h += `<div class="sw-outfit-card ${a ? 'sw-outfit-active' : ''}" data-id="${o.id}">
                <div class="sw-outfit-img-wrap"><img src="${esc(swImgSrc(o))}" alt="${esc(o.name)}" class="sw-outfit-img" loading="lazy">${a ? '<div class="sw-active-badge"><i class="fa-solid fa-check"></i></div>' : ''}<div class="sw-type-badge" title="${esc(tm.label)}"><i class="fa-solid ${tm.icon}"></i></div>${tryOnBadge}</div>
                <div class="sw-outfit-footer"><span class="sw-outfit-name" title="${esc(oDesc || o.name)}">${esc(o.name)}</span>
                    <div class="sw-outfit-btns">
                        <div class="sw-btn-tryon ${o.tryOnSide ? 'sw-tryon-on' : ''}" title="${o.tryOnSide
                            ? `ПРИМЕРКА (${o.tryOnSide === 'bot' ? 'на персонажа' : 'на персону'}): при генерации уходит как аватарка — человек уже в наряде. Клик — сделать обычным нарядом`
                            : 'Обычный наряд: уходит отдельным референсом одежды. Клик — пометить как примерку (картинка = человек уже В наряде, уйдёт как аватарка)'}"><i class="fa-solid fa-person-rays"></i></div>
                        <div class="sw-btn-activate" title="${a ? 'Снять' : 'Надеть'}"><i class="fa-solid ${a ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></div>
                        <div class="sw-btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></div>
                        <div class="sw-btn-delete" title="Удалить"><i class="fa-solid fa-trash-can"></i></div>
                    </div></div>
                <select class="sw-type-select" title="Тип одежды">${opts}</select></div>`;
        }
        h += '</div>';

        // ── Пагинатор ──
        if (totalPages > 1) {
            h += `<div class="sw-pager">
                <div class="sw-pager-btn ${swPage === 0 ? 'sw-pager-dim' : ''}" data-pg="prev" title="Назад"><i class="fa-solid fa-chevron-left"></i></div>
                <span class="sw-pager-info">Стр. ${swPage + 1} / ${totalPages} <small>(${shown.length})</small></span>
                <div class="sw-pager-btn ${swPage >= totalPages - 1 ? 'sw-pager-dim' : ''}" data-pg="next" title="Вперёд"><i class="fa-solid fa-chevron-right"></i></div>
            </div>`;
        }

        c.innerHTML = h;

        // Пагинатор
        for (const b of c.querySelectorAll('.sw-pager-btn')) {
            b.addEventListener('click', () => {
                if (b.dataset.pg === 'prev' && swPage > 0) { swPage--; swRender(); }
                else if (b.dataset.pg === 'next' && swPage < totalPages - 1) { swPage++; swRender(); }
            });
        }

        // Кнопки режима: Перс / Общий
        for (const b of c.querySelectorAll('.sw-mode-btn')) {
            b.addEventListener('click', async () => {
                const wantShared = b.dataset.mode === 'shared';
                const cfg = swSharedCfg(swTab);
                if (cfg.use() === wantShared) return; // уже в этом режиме
                cfg.setUse(wantShared); swSave();
                swFilter = 'all'; swPage = 0;
                swPreloadSharedActive(swTab);
                swRender(); swUpdatePromptInjection(); swInjectFloatingBtn();
                const sideName = swTab === 'bot' ? 'Бот' : 'Юзер';
                toastr.info(`${sideName}: ${wantShared ? 'общий гардероб (для всех персонажей)' : 'персональный гардероб'}`, 'Гардероб', { timeOut: 2000 });
                // При переходе в общий — просто надеваем уже имеющуюся копию (без импорта старых нарядов).
                if (wantShared) {
                    swAutoWearSharedFromCurrent(swTab, { force: false });
                    swPage = 0; swRender(); swUpdatePromptInjection(); swInjectFloatingBtn();
                }
            });
        }

        // Фильтр-чипы
        for (const chip of c.querySelectorAll('.sw-filter-chip')) {
            chip.addEventListener('click', () => { swFilter = chip.dataset.type; swPage = 0; swRender(); });
        }

        // Сортировка
        c.querySelector('.sw-sort-select')?.addEventListener('change', (e) => {
            swSort = e.target.value; swPage = 0; swRender();
        });

        document.getElementById('sw-upload-trigger')?.addEventListener('click', swUpload);
        document.getElementById('sw-gen-trigger')?.addEventListener('click', () => swOpenOutfitForm({ mode: 'gen', view: swCurrentView() }));
        for (const card of c.querySelectorAll('.sw-outfit-card[data-id]')) {
            const id = card.dataset.id;
            card.querySelector('.sw-outfit-img')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-btn-tryon')?.addEventListener('click', (e) => {
                e.preventDefault(); e.stopImmediatePropagation();
                const o = v.find(id); if (!o) return;
                if (o.tryOnSide) {
                    delete o.tryOnSide;
                    toastr.info(`«${o.name}» — обычный наряд: уходит отдельным референсом одежды`, 'Гардероб', { timeOut: 3500 });
                } else {
                    o.tryOnSide = v.side; // помечаем на сторону текущего таба — на ней образ и носится
                    toastr.success(`«${o.name}» — примерка: при генерации уйдёт как аватарка (${v.side === 'bot' ? 'персонажа' : 'персоны'})`, 'Гардероб', { timeOut: 3500 });
                }
                swSave(); swRender();
            });
            card.querySelector('.sw-btn-activate')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
            card.querySelector('.sw-btn-edit')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swEdit(id); });
            card.querySelector('.sw-btn-delete')?.addEventListener('click', (e) => {
                e.preventDefault(); e.stopImmediatePropagation();
                if (!confirm('Удалить?')) return;
                v.remove(id);
                if (v.shared) swPreloadSharedActive(v.side);
                swUpdatePromptInjection(); swInjectFloatingBtn(); swRender();
                toastr.info('Удалён', 'Гардероб');
            });
            card.querySelector('.sw-type-select')?.addEventListener('change', (e) => {
                e.stopImmediatePropagation();
                const o = v.find(id);
                if (o) { o.type = e.target.value; swSave(); swRender(); }
            });
        }
    }

    function swToggle(id) {
        const v = swCurrentView();
        const o = v.find(id), nm = o?.name || id;
        const off = v.activeId() === id;
        if (v.setActive(off ? null : id) === false) return;
        if (!off && o) { o.lastWorn = Date.now(); swSave(); } // отметка времени для сортировки «недавно надетые»
        if (v.shared) swPreloadSharedActive(v.side);
        swRender();
        swUpdatePromptInjection();
        swInjectFloatingBtn();
        off ? toastr.info(`«${nm}» снят`, 'Гардероб', { timeOut: 2000 }) : toastr.success(`«${nm}» надет`, 'Гардероб', { timeOut: 2000 });
    }

    /**
     * Compress base64 PNG to smaller JPEG for vision analysis.
     * Vision models don't need high-res: 384px JPEG is plenty for clothing.
     */
    function swCompressForVision(pngBase64, maxDim = 384) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxDim || h > maxDim) {
                    const s = maxDim / Math.max(w, h);
                    w = Math.round(w * s); h = Math.round(h * s);
                }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                const jpegDataUrl = c.toDataURL('image/jpeg', 0.85);
                const jpegB64 = jpegDataUrl.split(',')[1];
                swLog('INFO', `Vision image compressed: ${img.width}x${img.height} → ${w}x${h}, ~${Math.round(jpegB64.length / 1024)}KB JPEG`);
                resolve(jpegB64);
            };
            img.onerror = () => reject(new Error('Failed to decode image for vision compression'));
            img.src = 'data:image/png;base64,' + pngBase64;
        });
    }

    /**
     * Analyze outfit image via vision model.
     * Приоритет: Vision API из настроек SillyImages (таб Vision — тот же конфиг,
     * что для описаний референсов/аватаров). Если модель там не выбрана или
     * запрос упал — фолбэк на основную чат-модель ST (generateQuietPrompt).
     */
    async function swAnalyzeOutfit(base64) {
        const ctx = SillyTavern.getContext();

        // Compress to smaller JPEG for vision — reduces payload 5-10x
        let visionB64;
        try {
            visionB64 = await swCompressForVision(base64);
        } catch (e) {
            swLog('WARN', 'Vision compression failed, using original:', e.message);
            visionB64 = base64;
        }
        const visionMime = visionB64 === base64 ? 'image/png' : 'image/jpeg';
        const visionDataUrl = `data:${visionMime};base64,${visionB64}`;

        function cleanDesc(raw) {
            let s = String(raw || '');
            // Strip <think>...</think> reasoning blocks (also half-open <think> with no close)
            s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
            s = s.replace(/<\/?think\b[^>]*>/gi, '');
            // Strip common reasoning fences: ```thinking ... ``` / [thinking] ... [/thinking]
            s = s.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '');
            s = s.replace(/\[(?:thinking|thought|reasoning)\][\s\S]*?\[\/(?:thinking|thought|reasoning)\]/gi, '');
            return s.trim()
                .replace(/^["'`]+|["'`]+$/g, '')
                .replace(/^(Here|This|The image|I see|In this).{0,20}(shows?|features?|depicts?|displays?)\s*/i, '')
                .trim();
        }

        // 1) Vision API из настроек SillyImages — промпт берётся из поля «Промпт» таба Vision.
        const vc = getEffectiveVisionConfig();
        if (vc.endpoint && vc.apiKey && vc.model) {
            try {
                toastr.info('Анализ образа (Vision API)…', 'Гардероб', { timeOut: 15000 });
                const result = await callVisionApi(visionB64, vc.promptText, visionMime);
                const desc = cleanDesc(result);
                if (desc && desc.length > 10) {
                    swLog('INFO', 'Auto-described via Vision API:', desc.substring(0, 100));
                    return desc;
                }
                swLog('WARN', `Vision API response rejected (len=${desc.length}): "${desc.substring(0, 100)}"`);
            } catch (e) {
                swLog('WARN', 'Vision API failed, falling back to main chat model:', e.message);
                toastr.warning('Vision API не ответил, пробуем основную модель чата…', 'Гардероб', { timeOut: 3000 });
            }
        }

        // 2) Фолбэк: generateQuietPrompt with quietImage (proper ST vision pipeline)
        if (typeof ctx.generateQuietPrompt === 'function') {
            try {
                toastr.info('Анализ образа...', 'Гардероб', { timeOut: 15000 });
                const result = await ctx.generateQuietPrompt({
                    quietPrompt: '[OOC: STOP ROLEPLAY. You are now a fashion assistant. Describe ONLY the clothing visible in the attached image in 1-2 sentences in English. List garments, colors, fabrics, accessories, shoes. Do NOT write any narrative, dialogue, or RP content.]',
                    quietImage: visionDataUrl,
                    maxTokens: 150,
                });
                swLog('INFO', `generateQuietPrompt raw response: "${(result || '').substring(0, 200)}"`);
                const desc = cleanDesc(result);
                if (desc && desc.length > 10 && desc.length < 500) {
                    swLog('INFO', 'Auto-described via quietPrompt:', desc.substring(0, 100));
                    return desc;
                }
                swLog('WARN', `generateQuietPrompt response rejected (len=${desc.length}): "${desc.substring(0, 100)}"`);
            } catch (e) {
                swLog('WARN', 'generateQuietPrompt failed:', e.message);
            }
        }

        swLog('WARN', 'Auto-describe unavailable — all strategies failed');
        return null;
    }

    // ═════════════════════════════════════════════════════════
    //  ПРИМЕРКА (try-on): фулбоди-генерация «человек в этом наряде».
    //  Использует API-настройки и генераторы основного модуля SillyImages.
    // ═════════════════════════════════════════════════════════

    // Референс человека: ручное фото из слотов IIG → аватар персонажа/персоны ST.
    // Чекбоксы sendCharAvatar/sendUserAvatar тут не учитываются — примерка запрошена явно.
    async function swGetPersonRefB64(side) {
        const refs = getCurrentCharacterRefs();
        if (side === 'bot') {
            const manual = await getRefBase64(refs.charRef, 'charRef');
            if (manual) return manual;
            return await getCharacterAvatarBase64();
        }
        const manual = await getRefBase64(refs.userRef, 'userRef');
        if (manual) return manual;
        return await getUserAvatarBase64();
    }

    // Дефолтный шаблон промта примерки. Ключевые отличия от старой версии:
    //  (1) ЯВНО велит повторять арт-стиль аватар-референса (рендер/линии/шейдинг/палитра),
    //      а не уходить в обобщённый «fashion lookbook» — из-за чего стиль не совпадал с авой;
    //  (2) убран жёсткий студийный фон/свет, ломавший стиль.
    // Плейсхолдеры (подставляются в swBuildTryOnPrompt):
    //   {{name}}      — имя персонажа/персоны
    //   {{personRef}} — метка референса человека (CHARACTER/USER REFERENCE)
    //   {{outfitRef}} — метка референса наряда (CHARACTER/USER OUTFIT REFERENCE)
    //   {{outfit}}    — «Outfit details: …» (или пусто, если описания нет)
    const SW_DEFAULT_TRYON_PROMPT =
        'Virtual outfit try-on. Generate a FULL-BODY, head-to-toe image of {{name}} — the exact person from the {{personRef}} image — wearing EXACTLY the outfit from the {{outfitRef}} image.'
        + ' Keep the face, hairstyle, hair color, eye color, skin tone and body proportions identical to the person reference.'
        + ' Replace ALL of their clothing with the referenced outfit: same garments, colors, fabrics, patterns, accessories and footwear.'
        + ' CRITICAL — keep the same art style: render the result in the EXACT SAME art style, medium, line work, shading, color palette and overall aesthetic as the {{personRef}} image, as if drawn by the same artist. Do NOT switch to photography, 3D render or any different illustration style.'
        + ' Natural relaxed standing pose facing the viewer, the entire figure visible from head to shoes, simple uncluttered background that does not distract from the character.'
        + ' {{outfit}}';

    // Дефолтный шаблон генерации образа ПО ОПИСАНИЮ: картинки наряда нет, референсом уходит
    // только аватар, весь наряд задаётся текстом ({{outfit}}). Требования к стилю/позе — как у примерки.
    const SW_DEFAULT_GENLOOK_PROMPT =
        'Virtual outfit design. Generate a FULL-BODY, head-to-toe image of {{name}} — the exact person from the {{personRef}} image — wearing a NEW outfit that matches the text description below.'
        + ' Keep the face, hairstyle, hair color, eye color, skin tone and body proportions identical to the person reference.'
        + ' Replace ALL of their clothing with the described outfit: follow the description for garments, colors, fabrics, patterns, accessories and footwear; tastefully fill in any unspecified details so the outfit looks complete and coherent.'
        + ' CRITICAL — keep the same art style: render the result in the EXACT SAME art style, medium, line work, shading, color palette and overall aesthetic as the {{personRef}} image, as if drawn by the same artist. Do NOT switch to photography, 3D render or any different illustration style.'
        + ' Natural relaxed standing pose facing the viewer, the entire figure visible from head to shoes, simple uncluttered background that does not distract from the character.'
        + ' {{outfit}}';

    function swBuildTryOnPrompt(side, outfitDesc, { fromDescription = false } = {}) {
        const ctx = SillyTavern.getContext();
        const name = side === 'bot' ? (swCharName() || 'the character') : (ctx.name1 || 'the user');
        const personRef = side === 'bot' ? 'CHARACTER REFERENCE' : 'USER REFERENCE';
        const outfitRef = side === 'bot' ? 'CHARACTER OUTFIT REFERENCE' : 'USER OUTFIT REFERENCE';
        const s = swGetSettings();
        const tpl = fromDescription
            ? ((s.genLookPrompt || '').trim() || SW_DEFAULT_GENLOOK_PROMPT)
            : ((s.tryOnPrompt || '').trim() || SW_DEFAULT_TRYON_PROMPT);
        const d = swSanitizeDesc(outfitDesc);
        const outfitClause = d ? (fromDescription ? `Outfit description: ${d}` : `Outfit details: ${d}`) : '';
        // Функции-заменители, чтобы '$' в имени/описании не трактовался как спецпаттерн ($&, $1…).
        return tpl
            .replaceAll('{{name}}', () => name)
            .replaceAll('{{personRef}}', personRef)
            .replaceAll('{{outfitRef}}', outfitRef)
            .replaceAll('{{outfit}}', () => outfitClause)
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    /**
     * Сгенерировать примерку. side: 'bot' | 'user'. Возвращает PNG base64 (полный размер).
     * Диспетчеризация по провайдерам — как в generateImageWithRetry, но с ЯВНЫМИ
     * референсами (человек + наряд) и без авто-сбора контекста чата.
     * outfitB64 = null → режим «образ по описанию»: референс только аватар,
     * наряд целиком задаётся текстом outfitDesc (шаблон SW_DEFAULT_GENLOOK_PROMPT).
     */
    async function swTryOnGenerate(side, outfitB64, outfitDesc) {
        validateSettings(); // бросает понятную ошибку, если API не настроен
        const settings = getSettings();
        const personB64 = await swGetPersonRefB64(side);
        if (!personB64) {
            throw new Error(side === 'bot'
                ? 'Нет референса персонажа: откройте чат с персонажем или загрузите фото в слот «Персонаж» в настройках SillyImages'
                : 'Нет референса персоны: выберите аватар персоны в ST или загрузите фото в слот «Юзер» в настройках SillyImages');
        }
        const fromDescription = !outfitB64;
        const refImages = fromDescription ? [personB64] : [personB64, outfitB64];
        const refLabels = side === 'bot'
            ? (fromDescription ? ['char_ref'] : ['char_ref', 'char_outfit'])
            : (fromDescription ? ['user_ref'] : ['user_ref', 'user_outfit']);
        const prompt = swBuildTryOnPrompt(side, outfitDesc, { fromDescription });
        // Примерка НЕ подмешивает глобальный пресет стиля ([Style: ...]): стиль должен
        // диктовать ТОЛЬКО аватар-референс (см. промт), иначе результат уходит в чужой стиль.
        const style = '';
        const opts = { aspectRatio: '2:3', refLabels };

        const apiType = settings.apiType;
        const fmt = apiType === 'custom' ? (settings.customRequestFormat || 'openai') : apiType;
        if (apiType === 'custom') opts.overrideUrl = (settings.customFullUrl || '').trim() || null;
        const useGemini = fmt === 'gemini' || (apiType !== 'custom' && isGeminiModel(settings.model));

        let generated;
        if (fmt === 'naistera') {
            generated = await generateImageNaistera(prompt, style, { ...opts, referenceImages: refImages.map(b => 'data:image/png;base64,' + b) });
        } else if (fmt === 'void') {
            generated = await generateImageVoid(prompt, style, refImages, opts);
        } else if (fmt === 'electronhub') {
            generated = await generateImageElectronHub(prompt, style, refImages, opts);
        } else if (useGemini) {
            generated = await generateImageGemini(prompt, style, refImages, opts);
        } else {
            generated = await generateImageOpenAI(prompt, style, refImages, opts);
        }

        // Некоторые провайдеры возвращают обычный URL вместо data URL.
        if (typeof generated === 'string' && /^https?:\/\//i.test(generated)) {
            generated = await imageUrlToDataUrl(generated);
        }
        if (typeof generated !== 'string' || !generated.startsWith('data:image/')) {
            throw new Error('API вернул не картинку (примерка поддерживает только изображения)');
        }
        // Нормализуем в PNG (webp и пр.) — дальше картинка живёт как base64 без mime.
        const png = await convertDataUrlToPng(generated);
        return parseImageDataUrl(png).base64Data;
    }

    // Ужать base64 до maxDimension для хранения в гардеробе (сгенерированные картинки большие).
    async function swShrinkForStore(b64) {
        try { return await compressBase64Image(b64, swGetSettings().maxDimension, 0.85); }
        catch (e) { swLog('WARN', 'try-on shrink failed, storing as is:', e.message); return b64; }
    }

    async function swUpload() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.addEventListener('change', async () => {
            const f = inp.files?.[0]; if (!f) return;
            const v = swCurrentView(); // читаем актуальный вид на момент добавления
            try {
                let dataUrl = await iigFileToDataUrl(f);
                dataUrl = await iigCropImageDialog(dataUrl);
                const { base64 } = await swResize(dataUrl, swGetSettings().maxDimension);
                swOpenOutfitForm({ mode: 'add', view: v, base64, defaultName: f.name.replace(/\.[^.]+$/, '') });
            } catch (e) { toastr.error('Ошибка: ' + e.message, 'Гардероб'); }
        });
        inp.click();
    }

    function swEdit(id) {
        const v = swCurrentView();
        const o = v.find(id); if (!o) return;
        swOpenOutfitForm({ mode: 'edit', view: v, item: o });
    }

    // ── Единая форма добавления/редактирования образа (вместо цепочки prompt/confirm) ──
    function swOpenOutfitForm({ mode, view, base64 = null, item = null, defaultName = '' }) {
        document.getElementById('sw-form-overlay')?.remove();
        const isEdit = mode === 'edit';
        // Режим «gen»: образ создаётся ПО ОПИСАНИЮ — картинки на входе нет, она появится после генерации.
        const isGen = mode === 'gen';
        const curType = isEdit ? swTypeOf(item) : (swTypeIds().includes(swFilter) ? swFilter : 'other');
        let previewSrc = isEdit ? swImgSrc(item) : (base64 ? 'data:image/png;base64,' + base64 : '');
        const curName = isEdit ? (item.name || '') : (defaultName || '');
        const curDesc = isEdit ? swSanitizeDesc(item.description) : '';

        const stCtx = SillyTavern.getContext();
        const charNm = swCharName() || 'персонаж';
        const userNm = stCtx.name1 || 'персона';

        const ov = document.createElement('div'); ov.id = 'sw-form-overlay';
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        const panel = document.createElement('div'); panel.id = 'sw-form';
        panel.innerHTML = `
            <div class="sw-form-header"><span>${isEdit ? 'Редактировать образ' : (isGen ? 'Образ по описанию' : 'Новый образ')}</span><div class="sw-form-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div></div>
            <div class="sw-form-body">
                <div class="sw-form-preview">
                    <img src="${esc(previewSrc)}" alt="preview" ${isGen ? 'hidden' : ''}>
                    <div class="sw-form-crop" id="sw-form-crop" title="Кадрировать картинку" ${isGen ? 'hidden' : ''}><i class="fa-solid fa-crop-simple"></i></div>
                    <div class="sw-form-download" id="sw-form-download" title="Скачать картинку" ${isGen ? 'hidden' : ''}><i class="fa-solid fa-download"></i></div>
                    ${isGen ? '<div class="sw-form-preview-empty" id="sw-gen-empty"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Опишите образ в поле «Описание» и нажмите «Сгенерировать»</span></div>' : ''}
                </div>
                <div class="sw-tryon-row">
                    <select class="text_pole sw-tryon-select" id="sw-tryon-target" title="${isGen ? 'На кого генерировать образ' : 'На кого примерить наряд'}">
                        <option value="bot" ${view.side === 'bot' ? 'selected' : ''}>На персонажа — ${esc(charNm)}</option>
                        <option value="user" ${view.side === 'user' ? 'selected' : ''}>На персону — ${esc(userNm)}</option>
                    </select>
                    <div class="sw-tryon-btn" id="sw-tryon-btn" title="${isGen ? 'Сгенерировать фулбоди-картинку по описанию (ИИ): референсом уходит только аватар' : 'Сгенерировать фулбоди-картинку: персонаж в этом наряде (ИИ)'}"><i class="fa-solid ${isGen ? 'fa-wand-magic-sparkles' : 'fa-person-rays'}"></i> ${isGen ? 'Сгенерировать' : 'Примерить'}</div>
                </div>
                <div class="sw-tryon-status" id="sw-tryon-status" hidden></div>
                <div class="sw-tryon-pick" id="sw-tryon-pick" hidden>
                    <div class="sw-tryon-opt" data-pick="orig" title="Сохранить исходную картинку наряда"><img alt="оригинал"><span>Оригинал</span></div>
                    <div class="sw-tryon-opt" data-pick="gen" title="Сохранить сгенерированную примерку — при генерации картинок она уйдёт как аватар персонажа/персоны (наряд уже надет)"><img alt="примерка"><span>Примерка</span></div>
                </div>
                <label class="sw-form-label">Название</label>
                <input type="text" class="text_pole sw-form-input" id="sw-form-name" value="${esc(curName)}" placeholder="Название образа">
                <label class="sw-form-label">Тип одежды</label>
                <select class="text_pole sw-form-input" id="sw-form-type">${swTypes().map(t => `<option value="${t.id}" ${curType === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
                <label class="sw-form-label">Описание <span class="sw-form-ai" id="sw-form-ai" title="Сгенерировать описание по картинке (ИИ)"><i class="fa-solid fa-wand-magic-sparkles"></i> ИИ</span></label>
                <textarea class="text_pole sw-form-textarea" id="sw-form-desc" rows="4" placeholder="${isGen ? 'Опишите образ: одежда, цвета, ткани, аксессуары, обувь… — по этому тексту и генерируем' : 'Что на образе: одежда, цвета, ткани, аксессуары…'}">${esc(curDesc)}</textarea>
                <div class="sw-form-actions">
                    <div class="sw-form-btn sw-form-cancel">Отмена</div>
                    <div class="sw-form-btn sw-form-save">${isEdit ? 'Сохранить' : 'Добавить'}</div>
                </div>
            </div>`;
        ov.appendChild(panel); document.body.appendChild(ov);

        function formEsc(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }
        function close() { document.removeEventListener('keydown', formEsc, true); ov.remove(); }
        document.addEventListener('keydown', formEsc, true); // capture: закрыть форму раньше, чем сработает Esc модалки
        panel.querySelector('.sw-form-close').addEventListener('click', close);
        panel.querySelector('.sw-form-cancel').addEventListener('click', close);

        // Исходная картинка наряда (add: из загрузки; edit: лениво из base64/файла).
        let origB64 = base64;
        async function getFormImageB64() {
            if (origB64) return origB64;
            if (item) origB64 = item.base64 || ((item.imagePath && typeof loadRefImageAsBase64 === 'function') ? await loadRefImageAsBase64(item.imagePath) : null);
            return origB64;
        }

        // ИИ-описание по картинке
        panel.querySelector('#sw-form-ai').addEventListener('click', async () => {
            const aiBtn = panel.querySelector('#sw-form-ai');
            if (aiBtn.classList.contains('sw-form-ai-loading')) return;
            aiBtn.classList.add('sw-form-ai-loading');
            try {
                // В режиме «по описанию» анализировать можно только уже сгенерированную картинку.
                const b64 = isGen ? genB64 : await getFormImageB64();
                if (!b64) { toastr.warning(isGen ? 'Сначала сгенерируйте образ — тогда ИИ сможет описать картинку' : 'Нет картинки для анализа', 'Гардероб'); return; }
                const desc = await swAnalyzeOutfit(b64);
                if (desc) panel.querySelector('#sw-form-desc').value = desc;
                else toastr.warning('Не удалось получить описание', 'Гардероб');
            } catch (e) { toastr.error('Ошибка ИИ: ' + e.message, 'Гардероб'); }
            finally { aiBtn.classList.remove('sw-form-ai-loading'); }
        });

        // ── Примерка наряда (ИИ): фулбоди-генерация на персонажа/персону ──
        let genB64 = null;     // сгенерированная примерка (PNG, полный размер)
        let genSide = null;    // на кого сгенерирована примерка: 'bot' | 'user' (для флага tryOnSide)
        let picked = isGen ? 'gen' : 'orig'; // какая картинка будет сохранена: 'orig' | 'gen' (в gen-режиме оригинала нет)
        const previewImg = panel.querySelector('.sw-form-preview img');
        const tryBtn = panel.querySelector('#sw-tryon-btn');
        const tryStatus = panel.querySelector('#sw-tryon-status');
        const tryPick = panel.querySelector('#sw-tryon-pick');

        function refreshTryOnUI() {
            // В gen-режиме выбирать не из чего (оригинала нет) — пикер не показываем.
            tryPick.hidden = !genB64 || isGen;
            if (genB64 && !isGen) {
                tryPick.querySelector('[data-pick="orig"] img').src = previewSrc;
                tryPick.querySelector('[data-pick="gen"] img').src = 'data:image/png;base64,' + genB64;
                for (const o of tryPick.querySelectorAll('.sw-tryon-opt')) o.classList.toggle('sw-tryon-sel', o.dataset.pick === picked);
            }
            previewImg.src = (picked === 'gen' && genB64) ? ('data:image/png;base64,' + genB64) : previewSrc;
            if (isGen) {
                previewImg.hidden = !genB64;
                const empty = panel.querySelector('#sw-gen-empty');
                if (empty) empty.hidden = !!genB64;
            }
            // Кадрировать/скачивать нечего только в gen-режиме до первой генерации.
            if (cropBtn) cropBtn.hidden = isGen && !genB64;
            if (dlBtn) dlBtn.hidden = isGen && !genB64;
        }

        // ── Кадрирование картинки прямо из формы (та, что сейчас в превью) ──
        let imageDirty = false; // исходную картинку кадрировали → при сохранении перезаписать
        const cropBtn = panel.querySelector('#sw-form-crop');
        cropBtn?.addEventListener('click', async () => {
            try {
                const editingGen = picked === 'gen' && !!genB64;
                const b64 = editingGen ? genB64 : await getFormImageB64();
                if (!b64) { toastr.warning('Нет картинки для кадрирования', 'Гардероб'); return; }
                const srcUrl = 'data:image/png;base64,' + b64;
                const out = await iigCropImageDialog(srcUrl);
                if (!out || out === srcUrl) return; // отмена — без изменений
                const newB64 = out.split(',')[1];
                if (editingGen) {
                    genB64 = newB64;
                } else {
                    origB64 = newB64;
                    previewSrc = 'data:image/jpeg;base64,' + newB64;
                    imageDirty = true;
                }
                refreshTryOnUI();
            } catch (e) { toastr.error('Ошибка кадрирования: ' + e.message, 'Гардероб'); }
        });

        // ── Скачать картинку, которая сейчас в превью (оригинал или примерка) ──
        const dlBtn = panel.querySelector('#sw-form-download');
        dlBtn?.addEventListener('click', async () => {
            try {
                const b64 = (picked === 'gen' && genB64) ? genB64 : await getFormImageB64();
                if (!b64) { toastr.warning('Нет картинки для скачивания', 'Гардероб'); return; }
                const name = panel.querySelector('#sw-form-name').value.trim() || item?.name || 'outfit';
                await iigDownloadImage('data:image/png;base64,' + b64, name);
            } catch (e) { toastr.error('Ошибка: ' + e.message, 'Гардероб'); }
        });

        for (const o of tryPick.querySelectorAll('.sw-tryon-opt')) {
            o.addEventListener('click', () => { picked = o.dataset.pick === 'gen' ? 'gen' : 'orig'; refreshTryOnUI(); });
        }

        const tryBtnIdle = isGen
            ? '<i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать'
            : '<i class="fa-solid fa-person-rays"></i> Примерить';
        tryBtn.addEventListener('click', async () => {
            if (tryBtn.classList.contains('sw-tryon-busy')) return;
            const side = panel.querySelector('#sw-tryon-target').value === 'user' ? 'user' : 'bot';
            const descNow = panel.querySelector('#sw-form-desc').value.trim();
            if (isGen && !descNow) { toastr.warning('Опишите образ в поле «Описание» — по нему и генерируем', 'Гардероб'); return; }
            tryBtn.classList.add('sw-tryon-busy');
            tryBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Генерация…';
            tryStatus.hidden = false; tryStatus.textContent = 'Готовим референсы…';
            try {
                let srcB64 = null;
                if (!isGen) {
                    srcB64 = await getFormImageB64();
                    if (!srcB64) throw new Error('Не удалось получить картинку наряда');
                }
                tryStatus.textContent = `Генерация ${isGen ? 'образа' : 'примерки'}… (обычно 15–60 секунд)`;
                const out = await swTryOnGenerate(side, srcB64, descNow);
                if (!document.body.contains(panel)) return; // форму уже закрыли
                genB64 = out; genSide = side; picked = 'gen';
                refreshTryOnUI();
                tryStatus.hidden = true;
                toastr.success(isGen
                    ? 'Образ готов. Не нравится — поправьте описание и сгенерируйте ещё раз'
                    : 'Примерка готова. Ниже выберите, какую картинку сохранить в гардероб', 'Гардероб', { timeOut: 4000 });
            } catch (e) {
                swLog('ERROR', 'try-on failed:', e);
                if (document.body.contains(panel)) { tryStatus.hidden = false; tryStatus.textContent = '⚠ ' + String(e.message || e); }
                toastr.error(String(e.message || e).slice(0, 300), isGen ? 'Генерация образа не удалась' : 'Примерка не удалась', { timeOut: 6000 });
            } finally {
                if (document.body.contains(panel)) {
                    tryBtn.classList.remove('sw-tryon-busy');
                    tryBtn.innerHTML = tryBtnIdle;
                }
            }
        });

        // Сохранение
        panel.querySelector('.sw-form-save').addEventListener('click', async () => {
            const name = panel.querySelector('#sw-form-name').value.trim();
            if (!name) { toastr.warning('Введите название', 'Гардероб'); return; }
            if (isGen && !genB64) { toastr.warning('Сначала сгенерируйте образ — сохранять пока нечего', 'Гардероб'); return; }
            const type = panel.querySelector('#sw-form-type').value;
            const desc = panel.querySelector('#sw-form-desc').value.trim();
            const saveBtn = panel.querySelector('.sw-form-save');
            saveBtn.classList.add('sw-form-btn-busy'); saveBtn.textContent = 'Сохранение…';
            try {
                const useGen = picked === 'gen' && !!genB64;
                if (isEdit) {
                    item.name = name; item.type = type; item.description = desc;
                    if (useGen) {
                        // Заменяем картинку образа на сгенерированную примерку.
                        let stored = false;
                        if (view.shared) {
                            try {
                                if (typeof compressBase64Image === 'function' && typeof saveRefImageToFile === 'function') {
                                    const jpeg = await compressBase64Image(genB64, swGetSettings().maxDimension, 0.85);
                                    const prefix = view.side === 'bot' ? 'sw_bot_' : 'sw_user_';
                                    item.imagePath = await saveRefImageToFile(jpeg, prefix + name);
                                    delete item.base64;
                                    stored = true;
                                }
                            } catch (err) { swLog('WARN', 'try-on file store failed, fallback to base64:', err.message); }
                        }
                        if (!stored) { item.base64 = await swShrinkForStore(genB64); delete item.imagePath; }
                        // Картинка образа теперь — примерка (человек в наряде): помечаем, на кого
                        // она сгенерирована. При генерации такой образ уходит аватар-референсом.
                        item.tryOnSide = genSide;
                        // Кэш активного образа мог держать старую картинку этого id — сбрасываем.
                        swSharedCache[view.side].b64 = null; swSharedCache[view.side].id = null;
                    } else if (imageDirty && origB64) {
                        // Исходную картинку кадрировали в форме — перезаписываем.
                        let stored = false;
                        if (view.shared) {
                            try {
                                if (typeof compressBase64Image === 'function' && typeof saveRefImageToFile === 'function') {
                                    const jpeg = await compressBase64Image(origB64, swGetSettings().maxDimension, 0.85);
                                    const prefix = view.side === 'bot' ? 'sw_bot_' : 'sw_user_';
                                    item.imagePath = await saveRefImageToFile(jpeg, prefix + name);
                                    delete item.base64;
                                    stored = true;
                                }
                            } catch (err) { swLog('WARN', 'crop file store failed, fallback to base64:', err.message); }
                        }
                        if (!stored) { item.base64 = origB64; delete item.imagePath; }
                        swSharedCache[view.side].b64 = null; swSharedCache[view.side].id = null;
                    }
                    swSave();
                    if (view.shared) swPreloadSharedActive(view.side);
                } else {
                    const newItem = { id: uid(), name, type, description: desc, addedAt: Date.now() };
                    // Сохраняем примерку → помечаем, на кого она сгенерирована (уйдёт аватар-референсом).
                    if (useGen && genSide) newItem.tryOnSide = genSide;
                    // origB64 мог быть кадрирован в форме — он приоритетнее исходного base64.
                    const imgB64 = useGen ? genB64 : (origB64 || base64);
                    if (view.shared) {
                        // ⚡ ОБЩИЙ гардероб: картинку храним ФАЙЛОМ, в settings — только путь (не раздуваем settings.json).
                        let stored = false;
                        try {
                            if (typeof compressBase64Image === 'function' && typeof saveRefImageToFile === 'function') {
                                const jpeg = await compressBase64Image(imgB64, swGetSettings().maxDimension, 0.82);
                                const prefix = view.side === 'bot' ? 'sw_bot_' : 'sw_user_';
                                newItem.imagePath = await saveRefImageToFile(jpeg, prefix + name);
                                stored = true;
                            }
                        } catch (err) { swLog('WARN', 'shared file store failed, fallback to base64:', err.message); }
                        if (!stored) newItem.base64 = useGen ? await swShrinkForStore(imgB64) : imgB64;
                    } else {
                        newItem.base64 = useGen ? await swShrinkForStore(imgB64) : imgB64;
                    }
                    view.add(newItem);
                    if (view.shared) swPreloadSharedActive(view.side);
                    swSort = 'added'; swPage = 0; // показать новый образ сверху (сортировка «сначала новые»)
                }
                close();
                swRender(); swUpdatePromptInjection(); swInjectFloatingBtn();
                toastr.success(isEdit ? 'Обновлён' : `«${name}» добавлен`, 'Гардероб', { timeOut: 2000 });
                if (useGen && swGetSettings().tryOnAsAvatar) toastr.info('Образ-примерка: при генерации уйдёт как аватарка (наряд уже надет) — отдельный наряд не отправляется', 'Гардероб', { timeOut: 5000 });
            } catch (e) {
                toastr.error('Ошибка: ' + e.message, 'Гардероб');
                saveBtn.classList.remove('sw-form-btn-busy'); saveBtn.textContent = isEdit ? 'Сохранить' : 'Добавить';
            }
        });
    }

    // ── Prompt injection: outfit descriptions into main RP chat ──

    const SW_PROMPT_KEY = 'sillywardrobe_outfit';

    /**
     * Update the prompt injection with current active outfit descriptions.
     * Called on toggle, chat change, and app ready.
     */
    // Injection config — exposed for debug
    // position: 1 = IN_CHAT (vs 0 = IN_PROMPT after story string)
    // depth: 0 = absolute bottom of chat (right before generation prompt) — maximum recency
    // role: 0 = system, 1 = user, 2 = assistant
    const SW_INJECT_POSITION = 1; // IN_CHAT
    const SW_INJECT_DEPTH = 0;    // bottom — последнее, что видит модель
    const SW_INJECT_ROLE = 0;     // system
    const SW_INJECT_SCAN = false; // не сканировать для WI-триггеров

    function swBuildInjectionText(cn) {
        const botData = swGetActiveBotOutfit();
        const userData = swGetActiveUserOutfit();
        if (!botData && !userData) return '';

        const parts = [];
        // Bot outfit
        if (botData) {
            const desc = swSanitizeDesc(botData.description);
            const label = desc || botData.name || 'неизвестный наряд';
            parts.push(`${cn}: ${label}`);
        }
        // User outfit
        if (userData) {
            const desc = swSanitizeDesc(userData.description);
            const label = desc || userData.name || 'неизвестный наряд';
            parts.push(`{{user}}: ${label}`);
        }

        if (parts.length === 0) return '';

        // Минималистичная инъекция: просто факт «X одет(а) в это: ...»
        return `[Текущая одежда]\n${parts.join('\n')}`;
    }

    /**
     * Update the prompt injection with current active outfit descriptions.
     * Called on toggle, chat change, app ready, AND before every generation.
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
                ctx.setExtensionPrompt(SW_PROMPT_KEY, '', SW_INJECT_POSITION, SW_INJECT_DEPTH, SW_INJECT_SCAN, SW_INJECT_ROLE);
                return;
            }

            const injectionText = swBuildInjectionText(cn);

            // setExtensionPrompt(key, value, position, depth, scan, role)
            // Older ST versions ignore extra args — safe to pass.
            ctx.setExtensionPrompt(SW_PROMPT_KEY, injectionText, SW_INJECT_POSITION, SW_INJECT_DEPTH, SW_INJECT_SCAN, SW_INJECT_ROLE);

            if (injectionText) {
                const preview = injectionText.replace(/\s+/g, ' ').slice(0, 160);
                swLog('INFO', `Prompt injection set (pos=${SW_INJECT_POSITION}, depth=${SW_INJECT_DEPTH}, role=system): ${preview}…`);
            } else {
                swLog('INFO', 'Prompt injection cleared (no active outfits)');
            }
        } catch (e) {
            swLog('ERROR', 'Failed to update prompt injection:', e.message);
        }
    }

    // Public debug helper — call window.sillyWardrobe.debugInjection() from console
    function swDebugInjection() {
        const cn = swCharName();
        const text = cn ? swBuildInjectionText(cn) : '(no character)';
        console.log('[SW DEBUG] Active outfits for', cn, ':', swGetActive());
        console.log('[SW DEBUG] Injection text that will be sent:\n' + (text || '(empty)'));
        return text;
    }

    // ═════════════════════════════════════════════════════════
    //  QUICK SETTINGS PANEL — mini subset of extension settings
    //  Synced live with main settings (SillyTavern.extensionSettings.inline_image_gen)
    // ═════════════════════════════════════════════════════════

    function swOpenQuickSettings() {
        // Close any existing quick panel
        document.getElementById('sw-quick-overlay')?.remove();

        const ctx = SillyTavern.getContext();
        const iig = ctx.extensionSettings.inline_image_gen;
        if (!iig) { toastr.error('Настройки расширения не готовы', 'Быстрые настройки'); return; }

        const ov = document.createElement('div');
        ov.id = 'sw-quick-overlay';
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

        const panel = document.createElement('div');
        panel.id = 'sw-quick-panel';
        panel.innerHTML = `
            <div class="sw-quick-header">
                <span><i class="fa-solid fa-sliders"></i> Быстрые настройки</span>
                <div class="sw-quick-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="sw-quick-body">
                <label class="sw-quick-check">
                    <input type="checkbox" id="sw-q-enabled" ${iig.enabled ? 'checked' : ''}>
                    <span>Генерация включена</span>
                </label>

                <div class="sw-quick-row">
                    <label>Тип API</label>
                    <select id="sw-q-api-type" class="text_pole">
                        <option value="openai" ${iig.apiType === 'openai' ? 'selected' : ''}>OpenAI</option>
                        <option value="void" ${iig.apiType === 'void' ? 'selected' : ''}>VoidAI / RouteMyAI (chat)</option>
                        <option value="gemini" ${iig.apiType === 'gemini' ? 'selected' : ''}>Gemini / nano-banana</option>
                        <option value="naistera" ${iig.apiType === 'naistera' ? 'selected' : ''}>Naistera</option>
                        <option value="electronhub" ${iig.apiType === 'electronhub' ? 'selected' : ''}>Electron Hub</option>
                        <option value="custom" ${iig.apiType === 'custom' ? 'selected' : ''}>Custom (свой URL + формат)</option>
                    </select>
                </div>

                <div class="sw-quick-row">
                    <label>Эндпоинт</label>
                    <input type="text" id="sw-q-endpoint" class="text_pole" value="${esc(iig.endpoint || '')}" placeholder="https://api.example.com">
                </div>

                <div class="sw-quick-row">
                    <label>API ключ</label>
                    <div class="sw-quick-key-wrap">
                        <input type="password" id="sw-q-key" class="text_pole" value="${esc(iig.apiKey || '')}">
                        <div class="sw-quick-key-toggle" title="Показать/Скрыть"><i class="fa-solid fa-eye"></i></div>
                    </div>
                </div>

                <div class="sw-quick-row" id="sw-q-model-row" style="${iig.apiType === 'naistera' ? 'display:none;' : ''}">
                    <label>Модель</label>
                    <div class="sw-quick-model-wrap">
                        <select id="sw-q-model" class="text_pole">
                            ${iig.model ? `<option value="${esc(iig.model)}" selected>${esc(iig.model)}</option>` : '<option value="">-- Не выбрана --</option>'}
                        </select>
                        <div class="sw-quick-refresh" title="Обновить модели"><i class="fa-solid fa-sync"></i></div>
                    </div>
                </div>

                <div class="sw-quick-row" id="sw-q-aspect-row" style="${iig.apiType === 'gemini' ? '' : 'display:none;'}">
                    <label>Соотношение</label>
                    <select id="sw-q-aspect" class="text_pole">
                        <option value="1:1" ${iig.aspectRatio === '1:1' ? 'selected' : ''}>1:1</option>
                        <option value="2:3" ${iig.aspectRatio === '2:3' ? 'selected' : ''}>2:3</option>
                        <option value="3:2" ${iig.aspectRatio === '3:2' ? 'selected' : ''}>3:2</option>
                        <option value="9:16" ${iig.aspectRatio === '9:16' ? 'selected' : ''}>9:16</option>
                        <option value="16:9" ${iig.aspectRatio === '16:9' ? 'selected' : ''}>16:9</option>
                    </select>
                </div>

                <div class="sw-quick-row" id="sw-q-naistera-row" style="${iig.apiType === 'naistera' ? '' : 'display:none;'}">
                    <label>Naistera модель</label>
                    <select id="sw-q-naistera-model" class="text_pole">
                        <option value="grok" ${(iig.naisteraModel || 'grok') === 'grok' ? 'selected' : ''}>grok</option>
                        <option value="nano banana" ${iig.naisteraModel === 'nano banana' ? 'selected' : ''}>nano banana</option>
                    </select>
                </div>

                <div class="sw-quick-check-row">
                    <label class="sw-quick-check">
                        <input type="checkbox" id="sw-q-send-char" ${iig.sendCharAvatar ? 'checked' : ''}>
                        <span>Аватар {{char}}</span>
                    </label>
                    <label class="sw-quick-check">
                        <input type="checkbox" id="sw-q-send-user" ${iig.sendUserAvatar ? 'checked' : ''}>
                        <span>Аватар {{user}}</span>
                    </label>
                </div>

                <label class="sw-quick-check">
                    <input type="checkbox" id="sw-q-img-context" ${iig.imageContextEnabled ? 'checked' : ''}>
                    <span>Контекст картинок</span>
                </label>

                <div class="sw-quick-row" id="sw-q-img-context-count-row" style="${iig.imageContextEnabled ? '' : 'display:none;'}">
                    <label>Количество картинок</label>
                    <input type="number" id="sw-q-img-context-count" class="text_pole" min="1" max="3" step="1" value="${normalizeImageContextCount(iig.imageContextCount)}">
                </div>

                <div class="sw-quick-row sw-q-user-avatars-section ${iig.sendUserAvatar ? '' : 'sw-q-hidden'}" id="sw-q-user-avatars-wrap">
                    <label>
                        Аватар персоны {{user}}
                        <span class="sw-q-avatars-refresh" title="Обновить"><i class="fa-solid fa-sync"></i></span>
                    </label>
                    <div class="sw-q-avatars-grid" id="sw-q-avatars-grid">
                        <div class="sw-q-avatars-loading"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка...</div>
                    </div>
                </div>

                <div class="sw-quick-tags">
                    <label class="sw-quick-tags-title"><i class="fa-solid fa-tags"></i> Теги одежды</label>
                    <div class="sw-tags-list" id="sw-tags-list"></div>
                    <div class="sw-tags-add" id="sw-tags-add"><i class="fa-solid fa-plus"></i> Добавить тег</div>
                    <div class="sw-quick-hint">«Другое» удалить нельзя — это запасной тег. При удалении тега все его наряды переносятся в «Другое».</div>
                </div>

                <div class="sw-quick-tryon">
                    <label class="sw-quick-tags-title">
                        <i class="fa-solid fa-person-rays"></i> Промт примерки
                        <span class="sw-tryon-prompt-reset" id="sw-q-tryon-reset" title="Вернуть стандартный промт"><i class="fa-solid fa-rotate-left"></i> Сбросить</span>
                    </label>
                    <textarea id="sw-q-tryon-prompt" class="text_pole sw-tryon-prompt-area" rows="7" placeholder="Шаблон промта для ИИ-примерки">${esc(swGetSettings().tryOnPrompt || SW_DEFAULT_TRYON_PROMPT)}</textarea>
                    <div class="sw-quick-hint sw-tryon-prompt-hint">
                        Плейсхолдеры: <code>{{name}}</code> — имя, <code>{{personRef}}</code> — метка аватара,
                        <code>{{outfitRef}}</code> — метка наряда, <code>{{outfit}}</code> — описание наряда.
                        По умолчанию промт велит ИИ повторять арт-стиль аватара, чтобы примерка совпадала с авой.
                    </div>
                    <label class="sw-quick-tags-title" style="margin-top:10px;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Промт образа по описанию
                        <span class="sw-tryon-prompt-reset" id="sw-q-genlook-reset" title="Вернуть стандартный промт"><i class="fa-solid fa-rotate-left"></i> Сбросить</span>
                    </label>
                    <textarea id="sw-q-genlook-prompt" class="text_pole sw-tryon-prompt-area" rows="7" placeholder="Шаблон промта для генерации образа по описанию">${esc(swGetSettings().genLookPrompt || SW_DEFAULT_GENLOOK_PROMPT)}</textarea>
                    <div class="sw-quick-hint sw-tryon-prompt-hint">
                        Для карточки «Сгенерировать» в гардеробе: образ создаётся по тексту описания,
                        референсом уходит только аватар персонажа/персоны. Плейсхолдеры: <code>{{name}}</code> — имя,
                        <code>{{personRef}}</code> — метка аватара, <code>{{outfit}}</code> — описание образа.
                    </div>
                    <label class="sw-quick-check" style="margin-top:8px;">
                        <input type="checkbox" id="sw-q-tryon-avatar" ${swGetSettings().tryOnAsAvatar ? 'checked' : ''}>
                        <span>Примерка → аватар-референс</span>
                    </label>
                    <div class="sw-quick-hint">Если картинка надетого образа — сохранённая примерка, при генерации она отправляется как аватарка персонажа/персоны вместо пары «аватар + наряд». ИИ не перепутает, чья одежда, и референсов уходит меньше.</div>
                </div>

                <div class="sw-quick-hint">Настройки сохраняются автоматически и синхронизируются с панелью расширения.</div>

            </div>`;

        ov.appendChild(panel);
        document.body.appendChild(ov);

        panel.querySelector('.sw-quick-close').addEventListener('click', () => ov.remove());

        // ── Менеджер тегов одежды ──
        const tagsList = panel.querySelector('#sw-tags-list');
        swRenderTagManager(tagsList);
        panel.querySelector('#sw-tags-add')?.addEventListener('click', () => {
            const s = swGetSettings();
            // 'other' держим последним — новый тег вставляем перед ним.
            const tag = { id: uid(), label: 'Новый тег', icon: 'fa-tag' };
            const fb = s.outfitTypes.findIndex(t => t.id === SW_FALLBACK_TYPE);
            if (fb >= 0) s.outfitTypes.splice(fb, 0, tag); else s.outfitTypes.push(tag);
            swSave();
            swRenderTagManager(tagsList);
            if (swOpen) swRender();
            // Сразу выделить имя нового тега для ввода.
            tagsList.querySelector(`.sw-tag-row[data-id="${tag.id}"] .sw-tag-name`)?.focus();
        });

        // ── Промт примерки (try-on) ──
        const tryOnArea = panel.querySelector('#sw-q-tryon-prompt');
        tryOnArea?.addEventListener('input', () => {
            const v = tryOnArea.value;
            // Совпадение с дефолтом (или пусто) храним как '' → значит «использовать стандартный».
            swGetSettings().tryOnPrompt = (v.trim() && v.trim() !== SW_DEFAULT_TRYON_PROMPT.trim()) ? v : '';
            swSave();
        });
        panel.querySelector('#sw-q-tryon-reset')?.addEventListener('click', () => {
            swGetSettings().tryOnPrompt = '';
            swSave();
            if (tryOnArea) tryOnArea.value = SW_DEFAULT_TRYON_PROMPT;
            toastr.info('Промт примерки сброшен на стандартный', 'Гардероб', { timeOut: 2000 });
        });

        // ── Промт образа по описанию (генерация без картинки наряда) ──
        const genLookArea = panel.querySelector('#sw-q-genlook-prompt');
        genLookArea?.addEventListener('input', () => {
            const v = genLookArea.value;
            // Совпадение с дефолтом (или пусто) храним как '' → значит «использовать стандартный».
            swGetSettings().genLookPrompt = (v.trim() && v.trim() !== SW_DEFAULT_GENLOOK_PROMPT.trim()) ? v : '';
            swSave();
        });
        panel.querySelector('#sw-q-genlook-reset')?.addEventListener('click', () => {
            swGetSettings().genLookPrompt = '';
            swSave();
            if (genLookArea) genLookArea.value = SW_DEFAULT_GENLOOK_PROMPT;
            toastr.info('Промт образа по описанию сброшен на стандартный', 'Гардероб', { timeOut: 2000 });
        });
        panel.querySelector('#sw-q-tryon-avatar')?.addEventListener('change', (e) => {
            swGetSettings().tryOnAsAvatar = e.target.checked;
            swSave();
        });

        const save = () => ctx.saveSettingsDebounced();

        // Sync helper: also update main settings panel DOM if visible
        const syncMain = (id, value, isCheck = false) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (isCheck) el.checked = !!value;
            else el.value = value;
            try { el.dispatchEvent(new Event(isCheck ? 'change' : 'input', { bubbles: true })); } catch(e) {}
        };

        panel.querySelector('#sw-q-enabled').addEventListener('change', (e) => {
            iig.enabled = e.target.checked; save();
            syncMain('iig_enabled', iig.enabled, true);
        });

        const apiTypeSel = panel.querySelector('#sw-q-api-type');
        apiTypeSel.addEventListener('change', (e) => {
            iig.apiType = e.target.value; save();
            panel.querySelector('#sw-q-model-row').style.display = iig.apiType === 'naistera' ? 'none' : '';
            panel.querySelector('#sw-q-aspect-row').style.display = iig.apiType === 'gemini' ? '' : 'none';
            panel.querySelector('#sw-q-naistera-row').style.display = iig.apiType === 'naistera' ? '' : 'none';
            syncMain('iig_api_type', iig.apiType);
        });

        panel.querySelector('#sw-q-endpoint').addEventListener('input', (e) => {
            iig.endpoint = e.target.value; save();
            syncMain('iig_endpoint', iig.endpoint);
        });

        panel.querySelector('#sw-q-key').addEventListener('input', (e) => {
            iig.apiKey = e.target.value; save();
            syncMain('iig_api_key', iig.apiKey);
        });

        panel.querySelector('.sw-quick-key-toggle').addEventListener('click', () => {
            const inp = panel.querySelector('#sw-q-key');
            const icon = panel.querySelector('.sw-quick-key-toggle i');
            if (inp.type === 'password') { inp.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); }
            else { inp.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
        });

        panel.querySelector('#sw-q-model').addEventListener('change', (e) => {
            iig.model = e.target.value; save();
            syncMain('iig_model', iig.model);
        });

        panel.querySelector('#sw-q-aspect')?.addEventListener('change', (e) => {
            iig.aspectRatio = e.target.value; save();
            syncMain('iig_aspect_ratio', iig.aspectRatio);
        });

        panel.querySelector('#sw-q-naistera-model')?.addEventListener('change', (e) => {
            iig.naisteraModel = e.target.value; save();
            syncMain('iig_naistera_model', iig.naisteraModel);
        });

        panel.querySelector('#sw-q-send-char').addEventListener('change', (e) => {
            iig.sendCharAvatar = e.target.checked; save();
            syncMain('iig_send_char_avatar', iig.sendCharAvatar, true);
        });

        panel.querySelector('#sw-q-img-context')?.addEventListener('change', (e) => {
            iig.imageContextEnabled = e.target.checked; save();
            syncMain('iig_image_context_enabled', iig.imageContextEnabled, true);
            const r = panel.querySelector('#sw-q-img-context-count-row');
            if (r) r.style.display = iig.imageContextEnabled ? '' : 'none';
        });

        panel.querySelector('#sw-q-img-context-count')?.addEventListener('input', (e) => {
            const n = normalizeImageContextCount(e.target.value);
            iig.imageContextCount = n;
            e.target.value = String(n);
            save();
            syncMain('iig_image_context_count', n);
        });

        panel.querySelector('#sw-q-send-user').addEventListener('change', (e) => {
            iig.sendUserAvatar = e.target.checked; save();
            syncMain('iig_send_user_avatar', iig.sendUserAvatar, true);
            const sec = panel.querySelector('#sw-q-user-avatars-wrap');
            if (sec) sec.classList.toggle('sw-q-hidden', !iig.sendUserAvatar);
            if (iig.sendUserAvatar) loadUserAvatarsIntoQuick();
        });

        // ── User avatar visual grid ──
        const avatarGrid = panel.querySelector('#sw-q-avatars-grid');

        async function loadUserAvatarsIntoQuick() {
            if (!avatarGrid) return;
            avatarGrid.innerHTML = `<div class="sw-q-avatars-loading"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка...</div>`;
            try {
                const resp = await fetch('/api/avatars/get', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const avatars = await resp.json();
                renderAvatarGrid(avatars || []);
            } catch (err) {
                avatarGrid.innerHTML = `<div class="sw-q-avatars-err">Ошибка: ${esc(err.message)}</div>`;
            }
        }

        function renderAvatarGrid(avatars) {
            if (!avatarGrid) return;
            const currentAva = ctx.user_avatar || '';
            const selectedFile = iig.userAvatarFile || '';
            let html = `
                <div class="sw-q-avatar-item ${!selectedFile ? 'sw-q-avatar-sel' : ''}" data-file="">
                    <div class="sw-q-avatar-auto"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                    <span class="sw-q-avatar-name">Авто</span>
                </div>`;
            for (const f of avatars) {
                const isSel = selectedFile === f;
                const isCur = currentAva === f;
                const displayName = (typeof getPersonaDisplayName === 'function') ? getPersonaDisplayName(f) : f.replace(/\.[^.]+$/, '');
                html += `<div class="sw-q-avatar-item ${isSel ? 'sw-q-avatar-sel' : ''} ${isCur ? 'sw-q-avatar-cur' : ''}" data-file="${esc(f)}" title="${esc(displayName)} (${esc(f)})${isCur ? ' — активна в ST' : ''}">
                    <img src="/User Avatars/${encodeURIComponent(f)}" alt="${esc(displayName)}" loading="lazy" onerror="this.style.display='none'">
                    <span class="sw-q-avatar-name">${esc(displayName)}</span>
                    ${isCur ? '<div class="sw-q-avatar-cur-badge" title="Активная персона ST"><i class="fa-solid fa-star"></i></div>' : ''}
                    ${isSel ? '<div class="sw-q-avatar-sel-badge"><i class="fa-solid fa-check"></i></div>' : ''}
                </div>`;
            }

            avatarGrid.innerHTML = html;

            for (const item of avatarGrid.querySelectorAll('.sw-q-avatar-item')) {
                item.addEventListener('click', () => {
                    const file = item.dataset.file || '';
                    iig.userAvatarFile = file;
                    save();
                    // Try to sync with main panel dropdown if present
                    const mainSelected = document.getElementById('iig_user_avatar_dropdown_selected');
                    if (mainSelected && typeof selectUserAvatar === 'function') {
                        try { selectUserAvatar(file); } catch(x) {}
                    }
                    renderAvatarGrid(avatars);
                    toastr.info(file ? `Выбран: ${file}` : 'Авто (из персоны)', 'Быстрые настройки', { timeOut: 1500 });
                });
            }
        }

        panel.querySelector('.sw-q-avatars-refresh')?.addEventListener('click', (e) => {
            e.stopPropagation();
            loadUserAvatarsIntoQuick();
        });

        // Auto-load avatars if user toggle is already on
        if (iig.sendUserAvatar) {
            loadUserAvatarsIntoQuick();
        }

        // Refresh models

        panel.querySelector('.sw-quick-refresh').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.classList.add('loading');
            try {
                if (typeof fetchModels !== 'function') throw new Error('fetchModels недоступна');
                const models = await fetchModels();
                const select = panel.querySelector('#sw-q-model');
                const cur = iig.model;
                select.innerHTML = '<option value="">-- Выберите модель --</option>';
                for (const m of models) {
                    const opt = document.createElement('option');
                    opt.value = m; opt.textContent = m; opt.selected = m === cur;
                    select.appendChild(opt);
                }
                toastr.success(`Найдено моделей: ${models.length}`, 'Быстрые настройки');
            } catch (err) {
                toastr.error('Ошибка: ' + err.message, 'Быстрые настройки');
            } finally {
                btn.classList.remove('loading');
            }
        });
    }

    // ═════════════════════════════════════════════════════════
    //  NPC MANAGER PANEL — 4 fixed slots like main sillyimages panel
    //  Manages inline_image_gen.npcReferences (name + photo)
    // ═════════════════════════════════════════════════════════

    // NPC живёт одной полноценной вкладкой в настройках (как в novarakk/megarakk).
    // Кнопка «Менеджер NPC» в гардеробе — ярлык: закрывает модалку гардероба, открывает
    // панель расширений ST, разворачивает дровер настроек, переключает на вкладку NPC и
    // подскролливает к ней. Свой урезанный редактор больше не нужен.
    function swOpenNpcManager() {
        document.getElementById('sw-npc-overlay')?.remove();
        document.getElementById('sw-modal-overlay')?.remove();

        // 1) Открыть панель расширений ST, если свёрнута.
        const block = document.getElementById('rm_extensions_block');
        const needOpenPanel = !!block && block.classList.contains('closedDrawer');
        if (needOpenPanel) document.querySelector('#extensions-settings-button .drawer-toggle')?.click();

        const reveal = () => {
            const mega = document.getElementById('iig_refs_mega_section');
            if (!mega) { toastr.info('Откройте настройки «Генерация картинок» → вкладка NPC', 'NPC'); return; }
            // 2) Развернуть inline-дровер настроек расширения, если свёрнут.
            const content = mega.closest('.inline-drawer-content');
            if (content && (content.offsetParent === null || getComputedStyle(content).display === 'none')) {
                content.closest('.inline-drawer')?.querySelector('.inline-drawer-toggle')?.click();
            }
            // 2.5) Развернуть карточку «Референсы», если свёрнута.
            if (document.getElementById('iig_refs_body')?.classList.contains('iig-hidden')) {
                document.getElementById('iig_refs_toggle')?.click();
            }
            // 3) Переключиться на вкладку NPC и подскроллить к ней.
            mega.querySelector('.iig-ref-tab[data-tab="npc"]')?.click();
            setTimeout(() => mega.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        };
        // Если панель только что открыли — дать дроверу доехать перед скроллом.
        setTimeout(reveal, needOpenPanel ? 280 : 0);
    }

    // ═════════════════════════════════════════════════════════
    //  CLEANUP — чистка осиротевших файлов в папке iig_refs
    //  Файлы создаёт saveRefImageToFile (общий гардероб + NPC + референсы char/user).
    //  Удаляем ТОЛЬКО то, на что не ссылается НИКТО — с превью перед удалением.
    // ═════════════════════════════════════════════════════════

    // Собрать имена всех файлов, на которые ещё есть ссылки (по всем источникам).
    function swCollectReferencedFiles() {
        const ctx = SillyTavern.getContext();
        const referenced = new Set();
        let dir = '/user/images/iig_refs/';
        const addRef = (p) => {
            if (!p || typeof p !== 'string') return;
            const i = p.lastIndexOf('/');
            const base = i >= 0 ? p.slice(i + 1) : p;
            if (base) referenced.add(base);
            if (i > 0 && p.includes('iig_refs')) dir = p.slice(0, i + 1); // взять реальный префикс из существующего пути
        };
        const sw = ctx.extensionSettings?.silly_wardrobe;
        if (sw) {
            for (const o of (sw.sharedUserWardrobe || [])) addRef(o.imagePath);
            for (const o of (sw.sharedBotWardrobe || [])) addRef(o.imagePath);
            for (const w of Object.values(sw.wardrobes || {})) { // на всякий случай (per-char обычно base64)
                if (!w) continue;
                for (const side of ['bot', 'user']) for (const o of (w[side] || [])) addRef(o.imagePath);
            }
        }
        const iig = ctx.extensionSettings?.inline_image_gen;
        if (iig) {
            // Все ручные фото по всем персонажам/персонам, иначе чистка удалит используемые файлы.
            for (const r of Object.values(iig.charRefByKey || {})) addRef(r?.imagePath);
            for (const r of Object.values(iig.userRefByKey || {})) addRef(r?.imagePath);
            addRef(iig.charRef?.imagePath); // legacy/временные
            addRef(iig.userRef?.imagePath);
            for (const n of (iig.npcReferences || [])) addRef(n?.imagePath);
        }
        return { referenced, dir };
    }

    async function swScanOrphans() {
        const ctx = SillyTavern.getContext();
        const { referenced, dir } = swCollectReferencedFiles();
        const resp = await fetch('/api/images/list', {
            method: 'POST',
            headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: 'iig_refs', sortField: 'date', sortOrder: 'desc' }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const files = await resp.json();
        const list = Array.isArray(files) ? files.filter(f => typeof f === 'string') : [];
        const orphans = list.filter(f => !referenced.has(f));
        return { orphans, totalFiles: list.length, referencedCount: referenced.size, dir };
    }

    async function swDeleteFiles(dir, filenames) {
        const ctx = SillyTavern.getContext();
        let ok = 0, fail = 0;
        for (const f of filenames) {
            try {
                const r = await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: dir + f }),
                });
                if (r.ok) ok++; else fail++;
            } catch (e) { fail++; swLog('WARN', 'delete file failed:', f, e.message); }
        }
        return { ok, fail };
    }

    // ── Единое окно «Обслуживание»: вкладки «Дубликаты» и «Чистка файлов» ──
    function swOpenMaintenance(tab) {
        document.getElementById('sw-maint-overlay')?.remove();
        const ov = document.createElement('div'); ov.id = 'sw-maint-overlay';
        const panel = document.createElement('div'); panel.id = 'sw-maint-panel';
        panel.innerHTML = `
            <div class="sw-cleanup-header"><span><i class="fa-solid fa-broom"></i> Обслуживание гардероба</span><div class="sw-cleanup-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div></div>
            <div class="sw-maint-tabs">
                <div class="sw-maint-tab" data-mt="dedup"><i class="fa-solid fa-clone"></i> Дубликаты</div>
                <div class="sw-maint-tab" data-mt="cleanup"><i class="fa-solid fa-broom"></i> Чистка файлов</div>
            </div>
            <div class="sw-cleanup-body" id="sw-maint-body"></div>`;
        ov.appendChild(panel); document.body.appendChild(ov);
        const body = panel.querySelector('#sw-maint-body');

        function close() { document.removeEventListener('keydown', maintEsc, true); ov.remove(); }
        function maintEsc(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }
        document.addEventListener('keydown', maintEsc, true); // capture: закрыть это окно раньше гардероба
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        panel.querySelector('.sw-cleanup-close').addEventListener('click', close);

        let curTab = null;
        function show(which) {
            if (which === curTab) return;        // повторный клик по активной вкладке — без перерисовки/пересканирования
            curTab = which;
            for (const t of panel.querySelectorAll('.sw-maint-tab')) t.classList.toggle('sw-maint-tab-active', t.dataset.mt === which);
            if (which === 'cleanup') swRenderCleanup(body); else swRenderDedup(body);
        }
        for (const t of panel.querySelectorAll('.sw-maint-tab')) t.addEventListener('click', () => show(t.dataset.mt));
        show(tab === 'cleanup' ? 'cleanup' : 'dedup');
    }

    function swRenderCleanup(body) {
        const selected = new Set();
        let state = null;

        async function scan() {
            body.innerHTML = `<div class="sw-cleanup-loading"><i class="fa-solid fa-spinner fa-spin"></i> Сканирование…</div>`;
            try {
                state = await swScanOrphans();
                selected.clear();
                for (const f of state.orphans) selected.add(f); // по умолчанию выбраны все осиротевшие
                render();
            } catch (e) {
                body.innerHTML = `<div class="sw-cleanup-err">Ошибка: ${esc(e.message)}</div>`;
            }
        }

        function render() {
            const { orphans, totalFiles, referencedCount, dir } = state;
            let h = `<div class="sw-cleanup-info">Используется: <b>${referencedCount}</b> · Лишних: <b>${orphans.length}</b> · Всего в папке: ${totalFiles}</div>`;
            if (orphans.length === 0) {
                h += `<div class="sw-cleanup-empty"><i class="fa-solid fa-circle-check"></i> Лишних файлов нет — всё используется.</div>`;
                body.innerHTML = h; return;
            }
            h += `<div class="sw-cleanup-hint">На эти файлы не ссылается ни один наряд, NPC или референс. Клик по картинке — выбрать/снять. Удалятся только выбранные.</div>`;
            h += `<div class="sw-cleanup-tools"><span class="sw-cleanup-link" id="sw-cl-all">Выбрать все</span><span class="sw-cleanup-link" id="sw-cl-none">Снять все</span></div>`;
            h += '<div class="sw-cleanup-grid">';
            for (const f of orphans) {
                h += `<div class="sw-cleanup-item ${selected.has(f) ? 'sw-cl-sel' : ''}" data-f="${esc(f)}"><img src="${esc(dir + f)}" loading="lazy" onerror="this.style.opacity=0.15"><div class="sw-cl-check"><i class="fa-solid fa-check"></i></div></div>`;
            }
            h += '</div>';
            h += `<div class="sw-cleanup-actions"><div class="sw-cleanup-btn sw-cleanup-del">Удалить выбранные (<span id="sw-cl-count">${selected.size}</span>)</div></div>`;
            body.innerHTML = h;

            body.querySelector('#sw-cl-all').addEventListener('click', () => { for (const f of orphans) selected.add(f); render(); });
            body.querySelector('#sw-cl-none').addEventListener('click', () => { selected.clear(); render(); });
            for (const it of body.querySelectorAll('.sw-cleanup-item')) {
                it.addEventListener('click', () => {
                    const f = it.dataset.f;
                    if (selected.has(f)) selected.delete(f); else selected.add(f);
                    it.classList.toggle('sw-cl-sel');
                    const cnt = body.querySelector('#sw-cl-count'); if (cnt) cnt.textContent = selected.size;
                });
            }
            body.querySelector('.sw-cleanup-del').addEventListener('click', async () => {
                if (selected.size === 0) { toastr.info('Ничего не выбрано', 'Чистка'); return; }
                if (!confirm(`Удалить ${selected.size} файлов с сервера? Это необратимо.`)) return;
                const delBtn = body.querySelector('.sw-cleanup-del');
                delBtn.style.pointerEvents = 'none'; delBtn.textContent = 'Удаление…';
                const res = await swDeleteFiles(state.dir, [...selected]);
                toastr.success(`Удалено: ${res.ok}${res.fail ? `, ошибок: ${res.fail}` : ''}`, 'Чистка', { timeOut: 4000 });
                scan(); // пересканировать
            });
        }

        scan();
    }

    // ── Удаление дубликатов в текущем гардеробе (последствие старого импорта) ──
    // Группируем по файлу картинки (одинаковый imagePath = точный дубль) либо по имени+типу
    // для base64-образов. В каждой группе оставляем один (активный или самый ранний),
    // остальные предлагаем удалить — с превью и подтверждением. Сами файлы не трогаем:
    // осиротевшие картинки потом уберёт «Чистка».
    function swRenderDedup(body) {
        const view = swCurrentView();
        const sideName = swTab === 'bot' ? 'Бот' : 'Юзер';
        const modeName = view.shared ? 'общий' : 'персональный';

        // Ключ дубля. Импорт создаёт копии с РАЗНЫМИ файлами (imagePath), но одинаковыми
        // именем и srcId — поэтому сверяемся в первую очередь по имени+типу, затем по srcId
        // (копии одного источника), затем по файлу. Безымянные («Без имени») по имени НЕ
        // группируем, чтобы не слить разные образы в одну кучу.
        const dupKey = (o) => {
            const nm = (o.name || '').trim().toLowerCase();
            if (nm && nm !== 'без имени') return 'n:' + nm + '|' + swTypeOf(o);
            if (o.srcId) return 's:' + o.srcId;
            if (o.imagePath) return 'p:' + o.imagePath;
            return 'u:' + o.id; // уникум — не дубль
        };

        const selected = new Set();
        let dupItems = [];

        function compute() {
            const list = view.list() || [];
            const groups = new Map();
            for (const o of list) {
                const k = dupKey(o);
                if (k[0] === 'u') continue;                 // уникум — не группируем
                let arr = groups.get(k); if (!arr) groups.set(k, arr = []); arr.push(o);
            }
            const activeId = view.activeId();
            dupItems = []; selected.clear();
            let groupCount = 0;
            for (const g of groups.values()) {
                if (g.length < 2) continue;
                groupCount++;
                // оставляем активный (чтобы не снять надетое), иначе самый ранний
                const keep = g.find(o => o.id === activeId) || g.reduce((a, b) => ((a.addedAt || 0) <= (b.addedAt || 0) ? a : b));
                for (const o of g) if (o.id !== keep.id) { dupItems.push(o); selected.add(o.id); }
            }
            return groupCount;
        }

        function paint() {
            for (const it of body.querySelectorAll('.sw-cleanup-item')) it.classList.toggle('sw-cl-sel', selected.has(it.dataset.id));
            const cnt = body.querySelector('#sw-dd-count'); if (cnt) cnt.textContent = selected.size;
        }

        function render() {
            const groupCount = compute();
            const total = (view.list() || []).length;
            let h = `<div class="sw-cleanup-info">Гардероб: <b>${esc(sideName)}</b> (${esc(modeName)}) · дубликатов: <b>${dupItems.length}</b> в ${groupCount} группах · всего: ${total}</div>`;
            if (dupItems.length === 0) {
                h += `<div class="sw-cleanup-empty"><i class="fa-solid fa-circle-check"></i> Дубликатов не найдено.</div>`;
                body.innerHTML = h; return;
            }
            h += `<div class="sw-cleanup-hint">По одному образу из каждой группы остаётся (активный или самый ранний), остальные показаны ниже и помечены на удаление. Клик по картинке — снять/выбрать. Удаляются только записи гардероба; файлы потом уберёт «Чистка».</div>`;
            h += `<div class="sw-cleanup-tools"><span class="sw-cleanup-link" id="sw-dd-all">Выбрать все</span><span class="sw-cleanup-link" id="sw-dd-none">Снять все</span></div>`;
            h += '<div class="sw-cleanup-grid">';
            for (const o of dupItems) {
                h += `<div class="sw-cleanup-item ${selected.has(o.id) ? 'sw-cl-sel' : ''}" data-id="${esc(o.id)}" title="${esc(o.name || '')}"><img src="${esc(swImgSrc(o))}" loading="lazy" onerror="this.style.opacity=0.15"><div class="sw-cl-check"><i class="fa-solid fa-check"></i></div></div>`;
            }
            h += '</div>';
            h += `<div class="sw-cleanup-actions"><div class="sw-cleanup-btn sw-dd-del">Удалить дубли (<span id="sw-dd-count">${selected.size}</span>)</div></div>`;
            body.innerHTML = h;

            body.querySelector('#sw-dd-all').addEventListener('click', () => { for (const o of dupItems) selected.add(o.id); paint(); });
            body.querySelector('#sw-dd-none').addEventListener('click', () => { selected.clear(); paint(); });
            for (const it of body.querySelectorAll('.sw-cleanup-item')) {
                it.addEventListener('click', () => {
                    const id = it.dataset.id;
                    if (selected.has(id)) selected.delete(id); else selected.add(id);
                    paint();
                });
            }
            body.querySelector('.sw-dd-del').addEventListener('click', () => {
                if (selected.size === 0) { toastr.info('Ничего не выбрано', 'Дубликаты'); return; }
                if (!confirm(`Удалить ${selected.size} дубликатов из гардероба «${sideName} (${modeName})»?\n\nОстанется по одному каждого. Записи в гардеробе удалятся безвозвратно (файлы-картинки не трогаем).`)) return;
                const ids = [...selected];
                for (const id of ids) view.remove(id);
                swSave();
                toastr.success(`Удалено дубликатов: ${ids.length}`, 'Дубликаты', { timeOut: 4000 });
                swPage = 0; swRender(); swUpdatePromptInjection(); swInjectFloatingBtn();
                render(); // пересчитать оставшиеся
            });
        }

        render();
    }

    // Expose for inner references (arrow function references before hoist)
    window.swOpenQuickSettings = swOpenQuickSettings;
    window.swOpenNpcManager = swOpenNpcManager;
    window.swOpenMaintenance = swOpenMaintenance;

    // ── Bar button (inline in leftSendForm, like sims-action-btn) ──

    // Текущее размещение кнопки-гардероба ('bar' | 'float' | 'wand') с миграцией со старого флага.
    function swGetPlacement() {
        const s = swGetSettings();
        if (s.btnPlacement === 'bar' || s.btnPlacement === 'float' || s.btnPlacement === 'wand') return s.btnPlacement;
        return s.showFloatingBtn ? 'float' : 'bar';
    }
    function swSetPlacement(p) {
        if (p !== 'bar' && p !== 'float' && p !== 'wand') p = 'bar';
        const s = swGetSettings();
        s.btnPlacement = p;
        s.showFloatingBtn = (p === 'float'); // держим старый флаг в синхроне на случай чтения извне
        SillyTavern.getContext().saveSettingsDebounced();
        swInjectFloatingBtn();
    }
    function swActiveCount() {
        return (swGetActiveBotOutfit() ? 1 : 0) + (swGetActiveUserOutfit() ? 1 : 0);
    }

    function swInjectFloatingBtn() {
        // Взаимоисключение: кнопка живёт ровно в одном месте — в строке ввода, плавающая, или в «палочке».
        const placement = swGetPlacement();

        // Пункт в меню «волшебной палочки» — только в режиме 'wand'.
        swEnsureWandButton(placement === 'wand');

        if (placement === 'wand') {
            $('#sw-bar-btn').remove();
            swInjectFloatBtn(false);   // уберёт плавающую
            return;
        }
        if (placement === 'float') {
            $('#sw-bar-btn').remove(); // убираем кнопку из сендбара
            swInjectFloatBtn(true);    // показываем/обновляем плавающую
            return;
        }

        // placement === 'bar': кнопка в строке ввода (#leftSendForm).
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
        const count = swActiveCount();
        $btn.toggleClass('sw-bar-active', count > 0);
        $btn.html(`<i class="fa-solid fa-shirt"></i>${count > 0 ? `<span class="sw-bar-count">${count}</span>` : ''}`);
        $btn.show();
        swInjectFloatBtn(false); // на всякий случай уберём плавающую
    }

    // Плавающая кнопка-гардероб поверх чата. show=true → показать/обновить, иначе удалить.
    // Видна и на ПК, и на телефоне (position: fixed + высокий z-index + собственный фон).
    function swInjectFloatBtn(show) {
        let $fb = $('#sw-float-btn');
        if (!show) { if ($fb.length) $fb.remove(); return; }
        if ($fb.length === 0) {
            $fb = $('<div id="sw-float-btn" title="Гардероб"><i class="fa-solid fa-shirt"></i></div>');
            $fb.on('click touchend', function (e) { e.preventDefault(); e.stopPropagation(); swOpenModal(); });
            $('body').append($fb);
        }
        const count = swActiveCount();
        $fb.toggleClass('sw-float-active', count > 0);
        $fb.html(`<i class="fa-solid fa-shirt"></i>${count > 0 ? `<span class="sw-bar-count">${count}</span>` : ''}`);
        $fb.show();
    }

    // Пункт «Гардероб» в меню «волшебной палочки» (#extensionsMenu) — как у gallery/sillyvn.
    // show=false → удалить пункт. ST сам прячет саму палочку, если в меню нет видимых пунктов.
    function swEnsureWandButton(show) {
        let item = document.getElementById('sw_wand_button');
        if (!show) { if (item) item.remove(); return; }
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return; // меню ещё не построено — повторим на следующем хуке (APP_READY/CHAT_CHANGED)
        if (!item) {
            item = document.createElement('div');
            item.id = 'sw_wand_button';
            item.className = 'list-group-item flex-container flexGap5';
            item.title = 'Открыть гардероб';
            // Меню само закрывается по клику (обработчик на html в core), поэтому достаточно открыть модалку.
            item.addEventListener('click', () => swOpenModal());
            menu.appendChild(item);
        }
        const count = swActiveCount();
        item.innerHTML = `<div class="fa-solid fa-shirt extensionsMenuExtensionButton"></div><span>Гардероб${count > 0 ? ` (${count})` : ''}</span>`;
    }

    // ── Public API ──
    window.sillyWardrobe = {
        getActiveOutfitBase64(type) {
            const side = type === 'bot' ? 'bot' : 'user';
            // Общий гардероб: картинка в файле → отдаём предзагруженный кэш (синхронно).
            if (swSharedCfg(side).use()) return swSharedCache[side].b64;
            return swGetActiveSideOutfit(side)?.base64 || null;
        },
        // Async-вариант: гарантированно подгрузит base64 из файла, если кэш холодный.
        async getActiveOutfitBase64Async(type) {
            const side = type === 'bot' ? 'bot' : 'user';
            if (swSharedCfg(side).use()) {
                await swPreloadSharedActive(side);
                return swSharedCache[side].b64;
            }
            return swGetActiveSideOutfit(side)?.base64 || null;
        },
        getActiveOutfitDataUrl(type) { const b = this.getActiveOutfitBase64(type); return b ? `data:image/png;base64,${b}` : null; },
        getActiveOutfitData(type) { return swGetActiveSideOutfit(type === 'bot' ? 'bot' : 'user'); },
        // Активный образ стороны — ИИ-примерка (картинка = человек уже В наряде)?
        // true → при генерации картинка уходит аватар-референсом вместо пары «аватар + наряд».
        // Учитывает настройку tryOnAsAvatar и то, что примерка сгенерирована именно на ЭТУ сторону.
        isActiveOutfitTryOn(type) {
            const side = type === 'bot' ? 'bot' : 'user';
            if (!swGetSettings().tryOnAsAvatar) return false;
            return swGetActiveSideOutfit(side)?.tryOnSide === side;
        },
        debugInjection: swDebugInjection,
        forceReinject: swUpdatePromptInjection,
        preloadShared: swPreloadAllShared,
        refreshFloatBtn: () => swInjectFloatingBtn(),
        getPlacement: () => swGetPlacement(),
        setPlacement: (p) => swSetPlacement(p),
        migrateUserOutfits: () => swMigrateToShared('user'),
        migrateBotOutfits: () => swMigrateToShared('bot'),
        countPendingMigration: (side) => swCountPendingMigration(side === 'bot' ? 'bot' : 'user'),
        openModal: () => swOpenModal(),
        isReady: () => true,
    };

    // ── Init hooks ──
    const ctx = SillyTavern.getContext();

    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        setTimeout(() => { swPreloadAllShared(); swUpdatePromptInjection(); swInjectFloatingBtn(); }, 500);
    });

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => { swPreloadAllShared(); swUpdatePromptInjection(); swInjectFloatingBtn(); }, 300);
    });

    // ⚡ КРИТИЧНО: перезаписываем инжект перед КАЖДОЙ генерацией.
    // Страхуемся от race conditions, очистки контекста или забывчивости пользователя.
    // Пробуем все известные имена событий — какое доступно, то и сработает.
    const _genEvents = [
        'GENERATION_STARTED',
        'GENERATE_BEFORE_COMBINE_PROMPTS',
        'GENERATION_AFTER_COMMANDS',
        'MESSAGE_SENT',
    ];
    for (const evName of _genEvents) {
        const ev = ctx.event_types?.[evName];
        if (ev) {
            ctx.eventSource.on(ev, () => {
                try { swUpdatePromptInjection(); } catch (e) { swLog('WARN', `re-inject on ${evName} failed:`, e.message); }
            });
            swLog('INFO', `Subscribed to ${evName} for guaranteed re-injection`);
        }
    }

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

// Лок на перегенерацию отдельного тега (messageId:tagIndex) — от двойных кликов
// и от параллельного запуска «перегенерить всё» поверх одиночной перегенерации.
const activeSingleTagTasks = new Set();
function singleTagTaskKey(messageId, tagIndex) {
    return `${messageId}:${tagIndex}`;
}

// Log buffer for debugging
const logBuffer = [];
const MAX_LOG_ENTRIES = 200;

function iigLog(level, ...args) {
    // Buffer for export, but keep console quiet for INFO to avoid heavy load
    // (SillyTavern fires many events per generation; logging objects via JSON.stringify is expensive)
    const isInfo = level !== 'ERROR' && level !== 'WARN';
    if (isInfo && !window.IIG_DEBUG) {
        // Skip even buffering for INFO unless debug is enabled — saves CPU
        return;
    }
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
    } else if (window.IIG_DEBUG) {
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
    apiType: 'openai', // 'openai' | 'void' | 'gemini' | 'naistera' | 'electronhub' | 'custom'
    customRequestFormat: 'openai', // 'openai' | 'void' | 'gemini' | 'naistera' — when apiType === 'custom'
    customFullUrl: '', // optional: use the endpoint exactly as typed (no /v1/... append)
    endpoint: '',
    apiKey: '',
    model: '',
    // Connection presets (saved configs for quick switching)
    connectionPresets: [],
    activePresetId: '',
    size: '1024x1024',
    quality: 'standard',
    maxRetries: 0, // No auto-retry - user clicks error image to retry manually
    retryDelay: 1000,
    // Nano-banana specific
    aspectRatio: '1:1', // "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
    imageSize: '1K', // "1K", "2K", "4K"
    // Naistera specific
    naisteraAspectRatio: '1:1',
    naisteraModel: 'grok', // 'grok' | 'nano banana'
    naisteraVideoTest: false,
    naisteraVideoEveryN: 1,
    // Unified character references (flat storage — reliable on mobile)
    charRef: { name: '', imageBase64: '', imagePath: '' },
    userRef: { name: '', imageBase64: '', imagePath: '' },
    npcReferences: [],
    charDescription: '',
    userDescription: '',
    // Per-character / per-persona внешность. {{char}} ключуется по файлу аватара карточки
    // (character.avatar), {{user}} — по персоне ST (user_avatar). Старые charDescription/
    // userDescription/charRef/userRef остаются как источник для разовой миграции (migratePerCharOnce).
    charDescByKey: {},
    userDescByKey: {},
    charRefByKey: {},
    userRefByKey: {},
    injectDescriptions: true,
    // ── Avatar Library (порт из megarakk) ──
    // Кастомные аватары char/user. Элемент: {id, name, imageData(base64), target, appearance}.
    // Активный элемент даёт картинку-референс И текст внешности. Хранится по СТАБИЛЬНОМУ id —
    // поэтому всегда сохраняется (в отличие от ключей по персоне/персонажу).
    avatarItems: [],
    activeAvatarChar: null,
    activeAvatarUser: null,
    injectAvatarAppearanceToGeneration: true,
    injectAvatarAppearanceToChatEnabled: false,
    avatarAppearanceInjectionDepth: 1,
    // Avatar auto-send (from ST avatars)
    sendCharAvatar: false,
    sendUserAvatar: false,
    userAvatarFile: '',
    // Model list filter — false = только image-модели, true = вообще все модели с эндпоинта
    showAllModels: false,
    // ElectronHub-специфичные параметры
    electronhubStyle: '',          // например 'photographic', 'anime', 'cinematic' и т.д.
    electronhubNegativePrompt: '', // что НЕ хотим видеть на картинке
    electronhubGuidanceScale: '',  // 1.0–20.0, чем выше тем точнее следует промпту (но менее креативно)
    electronhubSteps: '',          // 10–100, больше = качественнее но медленнее
    electronhubEnableReferences: false, // экспериментальная поддержка референсов (большинство моделей не работает)
    // Кнопки-оверлеи на сгенерированных картинках в чате (галочки в «Параметрах генерации»).
    // Видимость управляется классами на body — см. applyImgActionButtonClasses().
    imgActionFullscreen: true, // «на весь экран»
    imgActionDownload: false,  // «скачать оригинал» (по умолчанию скачивание живёт во вьюере)
    imgActionRegen: true,      // «перегенерировать» (у картинок-ошибок остаётся всегда)
    // Стили (пресеты) — name + value, один активный.
    styles: [],
    activeStyleId: '',
    stylesOpen: true, // свёрнута ли карточка «Стили» в настройках
    // Лорбуки — коллекции ref-записей с триггерами, группами, приоритетами.
    lorebooks: [],
    activeLorebookId: '',
    // Отправлять текстовые описания совпавших лорбук-референсов в промпт картинки.
    sendRefDescriptions: true,
    // Vision API — отдельный эндпоинт для описания референсов через vision-модель.
    visionEndpoint: '',
    visionApiKey: '',
    visionModel: '',
    visionPrompt: '',
    // ── Иллюстрация сцены («картинка по истории») ──
    // Кнопка в wand-меню: вспомогательная LLM читает последний кусок РП и пишет промпт
    // картинки, дальше — обычный конвейер тегов (референсы/ретраи/перегенерация).
    historyPicEnabled: true,   // показывать пункт в «волшебной палочке»
    historyPicLlm: 'chat',     // кто пишет промпт: 'chat' — основная модель ST | 'vision' — эндпоинт из таба Vision
    historyPicMaxMessages: 20, // сколько сообщений максимум брать (с последней картинки, но не больше)
    // Промпт собирается из двух блоков: «Задача» (общий, учит LLM читать фрагмент и писать
    // промпт по железным правилам) + «Образ» (активный пресет: какую картинку делаем).
    historyPicTaskPrompt: '',  // Блок «Задача»; пусто = DEFAULT_HISTORYPIC_TASK
    historyPicPresets: [],     // свои пресеты «образа»: { id, name, text, aspectRatio, style, standalone }
    historyPicPresetId: 'hp-cinematic', // активный пресет (встроенный hp-* или свой iig-hp-*)
    historyPicPrompt: '',      // legacy: старый полный шаблон; мигрирует в standalone-пресет «Мой промпт»
    historyPicQuote: true,     // просить у LLM цитату-эпиграф и ставить её над картинкой
    historyPicHideFromContext: true, // вставлять иллюстрацию скрытым сообщением (is_system): в чате видно, в промпт LLM не уходит
    historyPicOpen: false,     // развёрнута ли карточка «Иллюстрация сцены» в настройках
    // ── Профили (полные именованные снимки настроек) ──
    // Каждый профиль несёт только выбранные секции (см. PROFILE_SECTIONS). Отдельно
    // от connectionPresets (те — только про подключение). Ключи хранятся локально,
    // при экспорте в файл секреты по умолчанию вырезаются.
    profiles: [],
    activeProfileId: '',
    profilesOpen: false, // развёрнута ли карточка «Профили» в настройках
    // Свёрнутость остальных карточек настроек — панель по умолчанию короткая.
    apiOpen: true,           // «Настройки API» (открыта: нужна при первичной настройке)
    imageContextOpen: false, // «Контекст картинок»
    genParamsOpen: false,    // «Параметры генерации»
    refsOpen: false,         // «Референсы»
    electronhubOpen: false,  // «Electron Hub»
    debugOpen: false,        // «Ошибки и отладка» (объединённая карточка)
    // Какие секции отмечены в чеклисте «Что сохранять» при создании/обновлении профиля.
    // По умолчанию профиль про КОНТЕНТ (активные авы/NPC/лорбуки/стиль); провайдер/параметры — по желанию.
    profileSaveScope: {
        avatars: true,
        npc: true,
        lorebooks: true,
        styles: true,
        connection: false,
        generation: false,
        imageContext: false,
        autoAvatar: false,
        descriptions: false,
        vision: false,
        historyPic: false,
        flags: false,
    },
});

const MAX_CONTEXT_IMAGES = 3;
// Лимит референс-картинок на запрос. Лорбук-рефы добавляются после char/user/NPC/гардероба,
// поэтому при 5 их часто срезало хвостом — даём запас, чтобы они доезжали до генерации.
const MAX_GENERATION_REFERENCE_IMAGES = 8;

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
 * Check if model is Gemini/nano-banana type. Accepts both proxy aliases (nano-banana*) and the
 * official Google ids (gemini-2.5-flash-image / gemini-3-pro-image / gemini-3.1-flash-image),
 * with or without a provider prefix like "google/". Ported from novarakk.
 */
function isGeminiModel(modelId) {
    let mid = String(modelId || '').toLowerCase();
    const slashIdx = mid.indexOf('/');
    if (slashIdx !== -1) mid = mid.slice(slashIdx + 1);
    return mid.includes('nano-banana')
        || mid.startsWith('gemini-2.5-flash-image')
        || mid.startsWith('gemini-3-pro-image')
        || mid.startsWith('gemini-3.1-flash-image');
}

/**
 * Gemini-style route: native Google /v1beta/models/{model}:generateContent wire format.
 * Use this in every place that branches on (apiType === 'gemini' || isGeminiModel(...)).
 */
function usesGeminiRoute(settings = getSettings()) {
    return settings.apiType === 'gemini' || isGeminiModel(settings.model);
}

const NAISTERA_MODELS = Object.freeze(['grok', 'grok-pro', 'nano banana', 'nano banana 2', 'novelai']);
const DEFAULT_ENDPOINTS = Object.freeze({
    naistera: 'https://naistera.org',
    electronhub: 'https://api.electronhub.top',
});
const ENDPOINT_PLACEHOLDERS = Object.freeze({
    openai: 'https://api.openai.com',
    void: 'https://api.voidai.app',
    gemini: 'https://generativelanguage.googleapis.com',
    naistera: 'https://naistera.org',
    electronhub: 'https://api.electronhub.top',
    custom: 'https://your-api.com/v1/images/generations  (полный URL или базовый)',
});

// Built-in default hosts we prefill when a provider is selected. Used to decide whether an
// endpoint was auto-filled (safe to swap) vs hand-typed (keep) when switching providers.
const BUILTIN_DEFAULT_ENDPOINTS = Object.freeze([
    'https://api.openai.com',
    'https://api.voidai.app',
    'https://generativelanguage.googleapis.com',
    'https://naistera.org',
    'https://api.electronhub.top',
]);

function isBuiltinDefaultEndpoint(endpoint) {
    const t = String(endpoint || '').trim().replace(/\/+$/, '').toLowerCase();
    return BUILTIN_DEFAULT_ENDPOINTS.includes(t);
}

let _lastGenDebug = null;

function normalizeNaisteraModel(model) {
    const raw = String(model || '').trim().toLowerCase();
    if (!raw) return 'grok';
    if (raw === 'nano-banana') return 'nano banana';
    if (raw === 'nano-banana-pro') return 'nano banana';
    if (raw === 'nano-banana-2') return 'nano banana 2';
    if (raw === 'nano banana pro') return 'nano banana';
    if (raw === 'novel ai' || raw === 'novel-ai' || raw === 'nai') return 'novelai';
    if (NAISTERA_MODELS.includes(raw)) return raw;
    return 'grok';
}

function shouldUseNaisteraVideoTest(model) {
    const normalized = normalizeNaisteraModel(model);
    // novelai and grok-pro don't support video mode
    return normalized !== 'novelai' && normalized !== 'grok-pro';
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
        if (apiType === 'naistera') return DEFAULT_ENDPOINTS.naistera;
        return '';
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

    // Миграция: неизвестный тип API (настройки от старой/другой сборки) — переводим на gemini.
    const knownApiTypes = ['openai', 'void', 'gemini', 'naistera', 'electronhub', 'custom'];
    if (!knownApiTypes.includes(context.extensionSettings[MODULE_NAME].apiType)) {
        context.extensionSettings[MODULE_NAME].apiType = 'gemini';
    }

    return context.extensionSettings[MODULE_NAME];
}

/**
 * Save settings
 */
function saveSettings() {
    const context = SillyTavern.getContext();
    if (typeof window.saveSettings === 'function') {
        try { window.saveSettings(); } catch(e) { context.saveSettingsDebounced(); }
    } else {
        context.saveSettingsDebounced();
    }
    persistRefsToLocalStorage();
}

function getMessageRenderText(message, settings = getSettings()) {
    if (!message) return '';
    if (settings.externalBlocks && message.extra?.display_text) {
        return message.extra.display_text;
    }
    return message.mes || '';
}

// ── Style presets ──

const IIG_STYLE_SOURCE_URL = 'https://wewwaistyping.github.io/slayimagespromts/';
const IIG_STYLE_CACHE_KEY = 'iig_site_styles_cache_v1';
const IIG_STYLE_CACHE_TTL = 24 * 60 * 60 * 1000;

function ensureStyles(settings = getSettings()) {
    if (!Array.isArray(settings.styles)) {
        const legacy = Array.isArray(settings.stylePresets) ? settings.stylePresets : [];
        settings.styles = legacy.map(p => ({
            id: String(p?.id || `iig-s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            name: String(p?.name || '').trim(),
            value: String(p?.style || p?.value || '').trim(),
        }));
    }
    settings.styles = settings.styles.map((s, i) => ({
        id: String(s?.id || `iig-s-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`),
        name: String(s?.name || `Стиль ${i + 1}`).trim(),
        value: String(s?.value ?? s?.style ?? '').trim(),
    }));
    if (!settings.styles.some(s => s.id === settings.activeStyleId)) settings.activeStyleId = '';
    return settings.styles;
}

function createStylePreset(name = '') {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const style = {
        id: `iig-s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(name || '').trim() || `Стиль ${styles.length + 1}`,
        value: '',
    };
    styles.push(style);
    settings.activeStyleId = style.id;
    return style;
}

function getActiveStylePreset(settings = getSettings()) {
    const styles = ensureStyles(settings);
    return styles.find(s => s.id === settings.activeStyleId) || null;
}

function updateStylePreset(styleId, patch) {
    const settings = getSettings();
    const style = ensureStyles(settings).find(s => s.id === styleId);
    if (!style) return null;
    if (patch.name !== undefined) style.name = String(patch.name || '').trim() || style.name;
    if (patch.value !== undefined) style.value = String(patch.value || '').trim();
    return style;
}

function removeStylePreset(styleId) {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const idx = styles.findIndex(s => s.id === styleId);
    if (idx === -1) return false;
    styles.splice(idx, 1);
    if (settings.activeStyleId === styleId) settings.activeStyleId = styles[0]?.id || '';
    return true;
}

function resolveEffectiveStyle(tagStyle = '') {
    const active = getActiveStylePreset();
    const preset = String(active?.value || '').trim();
    return preset || String(tagStyle || '').trim();
}

function readSiteStyleCache() {
    try {
        const raw = localStorage.getItem(IIG_STYLE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.styles) ? parsed : null;
    } catch { return null; }
}

function writeSiteStyleCache(styles, meta = {}) {
    try {
        localStorage.setItem(IIG_STYLE_CACHE_KEY, JSON.stringify({
            styles, etag: meta.etag || '', lastModified: meta.lastModified || '', ts: Date.now(),
        }));
    } catch { /* ignore */ }
}

function parseSiteStyles(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = [];
    for (const card of doc.querySelectorAll('article.style-card')) {
        const name = card.querySelector('h2.card-title')?.textContent?.trim() || '';
        const tags = String(card.getAttribute('data-tags') || '').split(',').map(t => t.trim()).filter(Boolean);
        const descEl = card.querySelector('p.card-desc');
        const description = (descEl?.getAttribute('data-ru') || descEl?.textContent || '').trim();
        const images = Array.from(card.querySelectorAll('.carousel-track img')).map(img => {
            const src = img.getAttribute('src') || '';
            if (!src) return '';
            try { return new URL(src, IIG_STYLE_SOURCE_URL).href; } catch { return ''; }
        }).filter(Boolean);
        const badgeEl = card.querySelector('.badge-green') || card.querySelector('.badge-yellow');
        const badge = (badgeEl?.getAttribute('data-ru') || badgeEl?.textContent || '').trim();
        const promptRaw = card.querySelector('.prompt-panel[data-panel="direct"] .prompt-code')?.textContent?.trim() || '';
        const prompt = promptRaw.replace(/^\[Describe your scene here\]\.\s*/i, '').trim();
        if (name && prompt) result.push({ name, tags, description, images, badge, prompt });
    }
    return result;
}

async function fetchSiteStyles(cached = null, force = false) {
    const headers = {};
    if (!force && cached?.etag) headers['If-None-Match'] = cached.etag;
    if (!force && cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const response = await fetch(IIG_STYLE_SOURCE_URL, { headers });
    if (response.status === 304 && cached) return { styles: cached.styles, notModified: true };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const styles = parseSiteStyles(html);
    writeSiteStyleCache(styles, {
        etag: response.headers.get('ETag') || '',
        lastModified: response.headers.get('Last-Modified') || '',
    });
    return { styles, notModified: false };
}

// ── Lorebook system ──

const MAX_LOREBOOK_REFS = 200;

function makeLorebookId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function normalizeGroupName(raw) {
    // Регистр сохраняем (как в оригинале 2.0-beta) — заголовки групп в {{iig-book}}
    // и в карточках отображаются ровно так, как ввёл пользователь.
    return String(raw || '').trim();
}

function normalizeSecondaryKeysString(raw) {
    return String(raw || '').split(',').map(k => k.trim()).filter(Boolean).join(', ');
}

function normalizeReferenceEntry(raw) {
    return {
        id: String(raw?.id || '').trim() || makeLorebookId(),
        name: String(raw?.name || '').trim(),
        description: String(raw?.description || '').trim(),
        imagePath: String(raw?.imagePath || '').trim(),
        matchMode: raw?.matchMode === 'always' ? 'always' : 'match',
        enabled: raw?.enabled !== false,
        group: normalizeGroupName(raw?.group),
        priority: Number.isFinite(raw?.priority) ? raw.priority : 0,
        useRegex: raw?.useRegex === true,
        secondaryKeys: normalizeSecondaryKeysString(raw?.secondaryKeys),
    };
}

// Нормализует ссылку НА МЕСТЕ (не создаёт новый объект), сохраняя идентичность:
// UI-обработчики тумблеров держат ref по ссылке (bindLorebookRefCardEvents), а
// пересборка объектов орфанила эту ссылку → правки терялись (тумблер «сам включался»).
function normalizeReferenceEntryInPlace(ref) {
    if (!ref || typeof ref !== 'object') return normalizeReferenceEntry(ref);
    ref.id = String(ref.id || '').trim() || makeLorebookId();
    ref.name = String(ref.name || '').trim();
    ref.description = String(ref.description || '').trim();
    ref.imagePath = String(ref.imagePath || '').trim();
    ref.matchMode = ref.matchMode === 'always' ? 'always' : 'match';
    ref.enabled = ref.enabled !== false;
    ref.group = normalizeGroupName(ref.group);
    ref.priority = Number.isFinite(ref.priority) ? ref.priority : 0;
    ref.useRegex = ref.useRegex === true;
    ref.secondaryKeys = normalizeSecondaryKeysString(ref.secondaryKeys);
    return ref;
}

function normalizeReferencesArrayInternal(raw) {
    if (!Array.isArray(raw)) return [];
    if (raw.length > MAX_LOREBOOK_REFS) raw.length = MAX_LOREBOOK_REFS;
    for (let i = 0; i < raw.length; i++) {
        raw[i] = normalizeReferenceEntryInPlace(raw[i]);
    }
    return raw;
}

function ensureLorebooks(settings = getSettings()) {
    if (!Array.isArray(settings.lorebooks)) {
        settings.lorebooks = [];
    }
    // Нормализуем НА МЕСТЕ, сохраняя идентичность объектов лорбуков и рефов:
    // UI держит их по ссылке, а пересборка новыми объектами теряла правки тумблеров.
    settings.lorebooks = settings.lorebooks.filter(lb => lb && typeof lb === 'object');
    for (const lb of settings.lorebooks) {
        lb.id = String(lb.id || '').trim() || makeLorebookId();
        lb.name = String(lb.name || '').trim() || 'Untitled';
        lb.enabled = lb.enabled !== false;
        lb.refs = normalizeReferencesArrayInternal(lb.refs);
        lb.meta = {
            sourceUrl: String(lb.meta?.sourceUrl || '').trim(),
            importedAt: Number.isFinite(lb.meta?.importedAt) ? lb.meta.importedAt : null,
            version: Number.isFinite(lb.meta?.version) ? lb.meta.version : null,
        };
    }
    if (settings.lorebooks.length === 0) {
        settings.lorebooks.push({
            id: makeLorebookId(),
            name: 'My library',
            enabled: true,
            refs: [],
            meta: { sourceUrl: '', importedAt: null, version: null },
        });
    }
    if (!settings.lorebooks.some(lb => lb.id === settings.activeLorebookId)) {
        settings.activeLorebookId = settings.lorebooks[0].id;
    }
    return settings.lorebooks;
}

function getActiveLorebook(settings = getSettings()) {
    const lorebooks = ensureLorebooks(settings);
    return lorebooks.find(lb => lb.id === settings.activeLorebookId) || lorebooks[0] || null;
}

function ensureActiveLorebookRefs(settings = getSettings()) {
    const active = getActiveLorebook(settings);
    if (!active) return [];
    active.refs = normalizeReferencesArrayInternal(active.refs);
    return active.refs;
}

function getAllEnabledLorebookReferences(settings = getSettings()) {
    const lorebooks = ensureLorebooks(settings);
    const result = [];
    for (const lb of lorebooks) {
        if (!lb.enabled) continue;
        for (const ref of lb.refs) {
            result.push({ ...ref, _lorebookName: lb.name });
        }
    }
    return result;
}

function lorebookCreate(name, settings = getSettings()) {
    ensureLorebooks(settings);
    const lorebook = {
        id: makeLorebookId(),
        name: String(name || '').trim() || `Lorebook ${settings.lorebooks.length + 1}`,
        enabled: true,
        refs: [],
        meta: { sourceUrl: '', importedAt: Date.now(), version: null },
    };
    settings.lorebooks.push(lorebook);
    settings.activeLorebookId = lorebook.id;
    return lorebook;
}

function lorebookRename(lorebookId, newName, settings = getSettings()) {
    const lb = ensureLorebooks(settings).find(x => x.id === lorebookId);
    if (!lb) return null;
    lb.name = String(newName || '').trim() || lb.name;
    return lb;
}

function lorebookSetEnabled(lorebookId, enabled, settings = getSettings()) {
    const lb = ensureLorebooks(settings).find(x => x.id === lorebookId);
    if (!lb) return null;
    lb.enabled = Boolean(enabled);
    return lb;
}

function lorebookRemove(lorebookId, settings = getSettings()) {
    const lorebooks = ensureLorebooks(settings);
    if (lorebooks.length <= 1) return false;
    const index = lorebooks.findIndex(x => x.id === lorebookId);
    if (index === -1) return false;
    lorebooks.splice(index, 1);
    if (settings.activeLorebookId === lorebookId) {
        settings.activeLorebookId = lorebooks[0]?.id || '';
    }
    return true;
}

function lorebookSetActive(lorebookId, settings = getSettings()) {
    const lb = ensureLorebooks(settings).find(x => x.id === lorebookId);
    if (!lb) return null;
    settings.activeLorebookId = lb.id;
    return lb;
}

// ── Lorebook matching ──

function normalizeReferenceTriggerText(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ');
}

function promptContainsReferenceName(prompt, name) {
    const normalizedPrompt = String(prompt || '').trim().toLowerCase();
    const normalizedName = normalizeReferenceTriggerText(name).toLowerCase();
    if (!normalizedPrompt || !normalizedName) return false;
    const pattern = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${pattern}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
        return regex.test(normalizedPrompt);
    } catch (_) {
        return normalizedPrompt.includes(normalizedName);
    }
}

function parseReferenceAliases(name) {
    return String(name || '').split(',').map(a => normalizeReferenceTriggerText(a)).filter(Boolean);
}

function findPrimaryKeyMatch(prompt, name, useRegex) {
    if (!useRegex) {
        const aliases = parseReferenceAliases(name);
        const hit = aliases.find(alias => promptContainsReferenceName(prompt, alias));
        return hit ? { kind: 'primary', detail: hit } : null;
    }
    const raw = String(name || '').trim();
    if (!raw) return null;
    let pattern = raw;
    let flags = 'iu';
    const slashMatch = raw.match(/^\/(.+)\/([gimsuvy]*)$/);
    if (slashMatch) {
        pattern = slashMatch[1];
        flags = slashMatch[2] || 'iu';
    }
    try {
        const regex = new RegExp(pattern, flags);
        return regex.test(String(prompt || '')) ? { kind: 'regex', detail: raw } : null;
    } catch (_) {
        if (String(prompt || '').toLowerCase().includes(pattern.toLowerCase())) {
            return { kind: 'regex-fallback', detail: raw };
        }
        return null;
    }
}

function promptMatchesAllSecondaryKeys(prompt, secondaryKeysRaw) {
    const keys = String(secondaryKeysRaw || '').split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) return true;
    return keys.every(key => promptContainsReferenceName(prompt, key));
}

function getMatchedLorebookReferences(prompt) {
    const refs = getAllEnabledLorebookReferences()
        .filter(ref => ref.enabled && ref.name && ref.imagePath);
    const matched = [];
    const seenKeys = new Set();
    for (const ref of refs) {
        let matchReason = null;
        if (ref.matchMode === 'always') {
            matchReason = { kind: 'always', detail: '' };
        } else {
            matchReason = findPrimaryKeyMatch(prompt, ref.name, ref.useRegex);
        }
        if (!matchReason) continue;
        if (!promptMatchesAllSecondaryKeys(prompt, ref.secondaryKeys)) continue;
        const dedupeKey = `${ref.name}::${ref.imagePath}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        matched.push({ ...ref, _matchReason: matchReason });
    }
    matched.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return matched;
}

// ── Vision API ──

const DEFAULT_VISION_PROMPT = 'Describe this clothing outfit in detail for a character in a roleplay. Focus on: type of garment, color, material/texture, style, notable features, accessories. Be concise but thorough (2-4 sentences). Write in English.';
const DEFAULT_REF_VISION_PROMPT = 'Describe what is shown in this reference image. Focus on the appearance, features, colors, and distinctive characteristics. Be concise but thorough (2-4 sentences). Write in English.';

function getEffectiveVisionConfig(settings = getSettings()) {
    const endpoint = String(settings.visionEndpoint || '').trim() || String(settings.endpoint || '').trim();
    const apiKey = String(settings.visionApiKey || '').trim() || String(settings.apiKey || '').trim();
    const model = String(settings.visionModel || '').trim();
    const promptText = String(settings.visionPrompt || '').trim() || DEFAULT_VISION_PROMPT;
    return { endpoint, apiKey, model, promptText };
}

async function callVisionApi(imageBase64, promptText, mime = 'image/png') {
    const { endpoint, apiKey, model } = getEffectiveVisionConfig();
    if (!endpoint) throw new Error('Vision: эндпоинт не настроен');
    if (!apiKey) throw new Error('Vision: API ключ не настроен');
    if (!model) throw new Error('Vision: модель не выбрана');
    const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
                    { type: 'text', text: promptText },
                ],
            }],
            max_tokens: 500,
            temperature: 0.3,
        }),
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Vision API ${response.status}: ${String(errorText).slice(0, 400)}`);
    }
    const result = await response.json();
    const description = String(result?.choices?.[0]?.message?.content || '').trim();
    if (!description) throw new Error('Vision: пустой ответ от модели');
    return description;
}

async function fetchVisionModels() {
    const { endpoint, apiKey } = getEffectiveVisionConfig();
    if (!endpoint || !apiKey) return [];
    const url = `${endpoint.replace(/\/+$/, '')}/v1/models`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data?.data) ? data.data : [];
        return list.map(m => String(m?.id || '')).filter(Boolean).sort();
    } catch (error) {
        iigLog('ERROR', `Vision fetchModels failed: ${error.message}`);
        toastr.error(`Ошибка загрузки vision-моделей: ${error.message}`, 'Генерация картинок');
        return [];
    }
}

async function generateReferenceDescription(refId) {
    const settings = getSettings();
    let targetRef = null;
    for (const lb of ensureLorebooks(settings)) {
        const found = lb.refs.find(r => r.id === refId);
        if (found) { targetRef = found; break; }
    }
    if (!targetRef) throw new Error('Референс не найден');
    const imagePath = targetRef.imagePath;
    if (!imagePath) throw new Error('Нет изображения для этого референса');
    const imgBase64 = await loadRefImageAsBase64(imagePath) || await imageUrlToBase64(imagePath);
    if (!imgBase64) throw new Error('Не удалось загрузить изображение референса');
    const description = await callVisionApi(imgBase64, DEFAULT_REF_VISION_PROMPT);
    iigLog('INFO', `Vision: описание для "${targetRef.name}": ${description.slice(0, 100)}`);
    targetRef.description = description;
    saveSettings();
    return description;
}

// ── Lorebook export/import ──

function buildLorebookExportJson(lorebook) {
    const refs = Array.isArray(lorebook?.refs) ? lorebook.refs : [];
    return {
        kind: 'iig-lorebook',
        version: 1,
        name: String(lorebook?.name || 'Lorebook'),
        refs: refs.map(ref => ({
            name: String(ref?.name || ''),
            description: String(ref?.description || ''),
            matchMode: ref?.matchMode === 'always' ? 'always' : 'match',
            enabled: ref?.enabled !== false,
            group: String(ref?.group || ''),
            priority: Number.isFinite(ref?.priority) ? ref.priority : 0,
            useRegex: ref?.useRegex === true,
            secondaryKeys: String(ref?.secondaryKeys || ''),
            imageUrl: '',
        })),
    };
}

function parseLorebookJson(rawText) {
    let payload;
    try { payload = JSON.parse(String(rawText || '')); } catch (e) {
        throw new Error(`Невалидный JSON: ${e.message}`);
    }
    if (!payload || typeof payload !== 'object') throw new Error('Невалидный лорбук');
    if (payload.kind !== 'iig-lorebook') throw new Error('Поле "kind" должно быть "iig-lorebook"');
    if (payload.version !== 1) throw new Error(`Неподдерживаемая версия: ${payload.version}`);
    if (!Array.isArray(payload.refs)) throw new Error('Поле "refs" должно быть массивом');
    return { kind: 'iig-lorebook', version: 1, name: String(payload.name || 'Imported lorebook'), refs: payload.refs };
}

async function importLorebookFromPayload(payload, meta = {}) {
    const settings = getSettings();
    const newLorebook = lorebookCreate(payload.name, settings);
    newLorebook.meta = {
        sourceUrl: String(meta.sourceUrl || '').trim(),
        importedAt: Date.now(),
        version: 1,
    };
    let imagesDownloaded = 0;
    let imagesFailed = 0;
    for (let index = 0; index < payload.refs.length; index++) {
        const raw = payload.refs[index];
        const ref = normalizeReferenceEntry(raw);
        ref.imagePath = '';
        const imageUrl = String(raw?.imageUrl || '').trim();
        if (imageUrl) {
            try {
                const dataUrl = await imageUrlToDataUrl(imageUrl);
                if (dataUrl) {
                    const b64 = dataUrl.split(',')[1];
                    ref.imagePath = await saveRefImageToFile(b64, `lorebook_${index}`);
                    imagesDownloaded++;
                }
            } catch (error) {
                iigLog('WARN', `Failed to download imageUrl for "${ref.name}": ${error.message}`);
                imagesFailed++;
            }
        }
        newLorebook.refs.push(ref);
    }
    saveSettings();
    return { lorebookId: newLorebook.id, refsCount: payload.refs.length, imagesDownloaded, imagesFailed };
}

async function importLorebookFromUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) throw new Error('URL пуст');
    const response = await fetch(trimmed);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const payload = parseLorebookJson(text);
    return importLorebookFromPayload(payload, { sourceUrl: trimmed });
}

async function importLorebookFromFile(file) {
    if (!(file instanceof File)) throw new Error('Файл не выбран');
    const text = await file.text();
    const payload = parseLorebookJson(text);
    return importLorebookFromPayload(payload);
}

function lorebookFileNameFromTitle(title) {
    const base = String(title || 'lorebook')
        .normalize('NFKD')
        .replace(/[^\w\s.-]+/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 64) || 'lorebook';
    return `${base}.iig.json`;
}

function triggerBrowserDownload(fileName, content, mimeType = 'application/json') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ── {{iig-book}} macro ──

function renderIigBookMacro(settings = getSettings()) {
    const lorebooks = ensureLorebooks(settings).filter(lb => lb.enabled !== false);
    if (lorebooks.length === 0) return '';
    const blocks = [];
    const showHeader = lorebooks.length > 1;
    for (const lb of lorebooks) {
        const active = lb.refs.filter(ref => ref.enabled !== false && String(ref?.name || '').trim());
        if (active.length === 0) continue;
        const groupOrder = [];
        const byGroup = new Map();
        for (const ref of active) {
            const g = normalizeGroupName(ref.group) || 'other';
            if (!byGroup.has(g)) { byGroup.set(g, []); groupOrder.push(g); }
            byGroup.get(g).push(ref);
        }
        const body = groupOrder.map(group => {
            const lines = byGroup.get(group).map(ref => {
                const trigger = parseReferenceAliases(ref.name)[0] || ref.name;
                const desc = String(ref.description || ref.name || '').trim();
                return `${ref.name} (${trigger}) — ${desc}`;
            });
            return `[${group}]\n${lines.join('\n')}`;
        }).join('\n\n');
        blocks.push(showHeader ? `=== ${lb.name} ===\n${body}` : body);
    }
    return blocks.join('\n\n');
}

function registerIigBookMacro() {
    try {
        const context = SillyTavern.getContext();
        if (typeof context?.registerMacro === 'function') {
            context.registerMacro('iig-book', () => renderIigBookMacro(), 'Inline Image Generation: renders lorebook references grouped by category.');
            iigLog('INFO', 'Registered {{iig-book}} macro');
        }
    } catch (error) {
        iigLog('WARN', 'Failed to register {{iig-book}} macro:', error.message);
    }
}

// ── Unified character references system (from aceeenvw/notsosillynotsoimages) ──

const LS_KEY = 'iig_npc_refs_v3';

/**
 * Compress a base64 image to reduce payload size.
 */
function compressBase64Image(rawBase64, maxDim = 768, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
                const scale = maxDim / Math.max(w, h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const b64 = dataUrl.split(',')[1];
            iigLog('INFO', `Compressed reference image: ${img.width}x${img.height} -> ${w}x${h}, ~${Math.round(b64.length / 1024)}KB`);
            resolve(b64);
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = 'data:image/jpeg;base64,' + rawBase64;
    });
}

// ── Кадрирование при загрузке и скачивание оригиналов ──

// Файл → dataURL (без сжатия — сырьё для диалога кадрирования).
function iigFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
    });
}

// Диалог кадрирования на штатном кроппере ST (POPUP_TYPE.CROP, свободные пропорции).
// «Обрезать» → кадрированный dataURL (JPEG); «Отмена» → исходный dataURL, картинка целиком.
async function iigCropImageDialog(dataUrl) {
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.callGenericPopup !== 'function' || !ctx.POPUP_TYPE?.CROP) return dataUrl;
        const cropped = await ctx.callGenericPopup(
            'Кадрирование: выделите нужную область. «Отмена» — использовать картинку целиком.',
            ctx.POPUP_TYPE.CROP, '', { cropAspect: NaN, cropImage: dataUrl });
        return (typeof cropped === 'string' && cropped.startsWith('data:')) ? cropped : dataUrl;
    } catch (e) {
        iigLog('WARN', 'Crop dialog failed, using original image:', e.message);
        return dataUrl;
    }
}

// Скачивание картинки В ОРИГИНАЛЬНОМ КАЧЕСТВЕ: fetch → blob → <a download>.
// Нужен потому, что из вьюеров (фуллскрин, галерея ST) на мобильных картинку
// по-человечески не вытащить — остаются только скриншоты.
// suggestedName — человекочитаемое имя файла (например, название образа гардероба).
async function iigDownloadImage(src, suggestedName = '') {
    if (!src) return;
    try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        let name = String(suggestedName || '').trim().replace(/[\\/:*?"<>|]/g, '_');
        if (!name && !src.startsWith('data:') && !src.startsWith('blob:')) {
            try { name = decodeURIComponent(new URL(src, window.location.href).pathname.split('/').pop() || ''); } catch (_) {}
        }
        if (!name) name = `iig_${new Date().toISOString().replace(/[:.]/g, '-')}`;
        if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
            const ext = ((blob.type.split('/')[1] || 'png').split('+')[0]).replace('jpeg', 'jpg');
            name = `${name}.${ext}`;
        }
        const objUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objUrl;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        toastr.success(name, 'Скачивание начато', { timeOut: 2000 });
    } catch (e) {
        iigLog('ERROR', 'Image download failed:', e.message);
        toastr.error('Не удалось скачать: ' + e.message, 'Генерация картинок');
    }
}

/**
 * Save a reference image as a file on the server.
 * Returns the server path string.
 */
async function saveRefImageToFile(base64Data, label) {
    const context = SillyTavern.getContext();
    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    const filename = `iig_ref_${safeName}_${Date.now()}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64Data,
            format: 'jpeg',
            ch_name: 'iig_refs',
            filename: filename
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown' }));
        throw new Error(err.error || `Upload failed: ${response.status}`);
    }
    const result = await response.json();
    iigLog('INFO', `Ref image saved to: ${result.path}`);
    return result.path;
}

/**
 * Load a reference image from server path → base64 string.
 */
// Приводит сохранённый путь картинки к виду, который точно зафетчится:
// data:/http(s) — как есть, иначе гарантируем ведущий «/» (порт из novarakk/megarakk).
// Без этого относительные пути (импортированные лорбуки и т.п.) молча падают в 404,
// из-за чего реф «не виден» при генерации.
function normalizeStoredImagePath(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:')) return raw;
    if (/^(?:https?:)?\/\//i.test(raw)) return raw;
    return raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`;
}

async function loadRefImageAsBase64(path) {
    const url = normalizeStoredImagePath(path);
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch(e) {
        iigLog('WARN', `loadRefImageAsBase64 failed for ${path}:`, e.message);
        return null;
    }
}

/**
 * Fetch list of user avatar files from ST server.
 */
async function fetchUserAvatars() {
    try {
        const context = SillyTavern.getContext();
        const response = await fetch('/api/avatars/get', { method: 'POST', headers: context.getRequestHeaders() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) { iigLog('WARN', 'fetchUserAvatars failed:', e.message); return []; }
}

/**
 * Get current ST character avatar as base64.
 */
async function getCharacterAvatarBase64() {
    try {
        const override = getActiveAvatarOverrideBase64('char');
        if (override) return override;
        const context = SillyTavern.getContext();
        if (context.characterId === undefined || context.characterId === null) return null;
        if (typeof context.getCharacterAvatar === 'function') {
            const url = context.getCharacterAvatar(context.characterId);
            if (url) { const b = await imageUrlToBase64(url); if (b) return b; }
        }
        const character = context.characters?.[context.characterId];
        if (character?.avatar) return await imageUrlToBase64(`/characters/${encodeURIComponent(character.avatar)}`);
        return null;
    } catch (e) { iigLog('WARN', 'getCharacterAvatarBase64 failed:', e.message); return null; }
}

/**
 * Get current ST user persona avatar as base64.
 */
async function getUserAvatarBase64() {
    try {
        const override = getActiveAvatarOverrideBase64('user');
        if (override) return override;
        const context = SillyTavern.getContext();
        const settings = getSettings();
        // Явный выбор в выпадашке главнее авто-персоны (пустой выбор «-- Авто --» = следовать за персоной ST).
        if (settings.userAvatarFile) {
            const b = await imageUrlToBase64(`/User Avatars/${encodeURIComponent(settings.userAvatarFile)}`);
            if (b) return b;
        }
        const currentAvatar = context.user_avatar;
        if (currentAvatar) {
            const b = await imageUrlToBase64(`/User Avatars/${encodeURIComponent(currentAvatar)}`);
            if (b) return b;
        }
        return null;
    } catch (e) { iigLog('WARN', 'getUserAvatarBase64 failed:', e.message); return null; }
}

/**
 * Get display name for a persona avatar file (persona name, fallback to filename).
 */
function getPersonaDisplayName(avatarFile) {
    if (!avatarFile) return '';
    try {
        const ctx = SillyTavern.getContext();
        const personas = ctx?.powerUserSettings?.personas
            || ctx?.power_user?.personas
            || window.power_user?.personas
            || {};
        const name = personas[avatarFile];
        if (name && typeof name === 'string' && name.trim()) return name.trim();
    } catch (e) { /* ignore */ }
    // Fallback: strip extension from filename
    return avatarFile.replace(/\.[^.]+$/, '');
}

/**
 * Render user avatar dropdown list.
 */
function renderUserAvatarDropdown(avatars = []) {
    const settings = getSettings();
    const list = document.getElementById('iig_user_avatar_dropdown_list');
    if (!list) return;
    list.innerHTML = '';


    const emptyItem = document.createElement('div');
    emptyItem.className = `iig-avatar-dropdown-item iig-no-avatar ${!settings.userAvatarFile ? 'selected' : ''}`;
    emptyItem.dataset.value = '';
    emptyItem.innerHTML = `
        <div style="width:32px;height:32px;border-radius:5px;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-wand-magic-sparkles" style="color:#5a5252;font-size:12px;"></i>
        </div>
        <span class="iig-item-name">-- Авто (из персоны) --</span>`;
    emptyItem.addEventListener('click', () => selectUserAvatar(''));
    list.appendChild(emptyItem);

    for (const avatarFile of avatars) {
        const item = document.createElement('div');
        item.className = `iig-avatar-dropdown-item ${settings.userAvatarFile === avatarFile ? 'selected' : ''}`;
        item.dataset.value = avatarFile;
        const thumb = document.createElement('img');
        thumb.className = 'iig-item-thumb';
        thumb.src = `/User Avatars/${encodeURIComponent(avatarFile)}`;
        thumb.alt = avatarFile;
        thumb.title = avatarFile;
        thumb.loading = 'lazy';
        thumb.onerror = function() { this.style.display = 'none'; };
        const name = document.createElement('span');
        name.className = 'iig-item-name';
        name.textContent = getPersonaDisplayName(avatarFile);
        name.title = avatarFile;
        item.appendChild(thumb);
        item.appendChild(name);
        item.addEventListener('click', () => selectUserAvatar(avatarFile));
        list.appendChild(item);
    }
}


async function loadAndRenderUserAvatars() {
    try {
        const avatars = await fetchUserAvatars();
        renderUserAvatarDropdown(avatars);
    } catch (e) {
        iigLog('ERROR', 'loadAndRenderUserAvatars:', e.message);
    }
}

function selectUserAvatar(avatarFile) {
    const settings = getSettings();
    settings.userAvatarFile = avatarFile;
    saveSettings();
    const selected = document.getElementById('iig_user_avatar_dropdown_selected');
    if (selected) {
        const displayName = avatarFile ? getPersonaDisplayName(avatarFile) : '';
        selected.innerHTML = avatarFile
            ? `<img class="iig-dropdown-thumb" src="/User Avatars/${encodeURIComponent(avatarFile)}" alt="" onerror="this.style.display='none'">
               <span class="iig-dropdown-text" title="${avatarFile}">${displayName}</span>
               <span class="iig-dropdown-arrow fa-solid fa-chevron-down"></span>`
            : `<div class="iig-dropdown-placeholder"><i class="fa-solid fa-user"></i></div>
               <span class="iig-dropdown-text">-- Авто (из персоны) --</span>
               <span class="iig-dropdown-arrow fa-solid fa-chevron-down"></span>`;
    }

    const list = document.getElementById('iig_user_avatar_dropdown_list');
    if (list) list.querySelectorAll('.iig-avatar-dropdown-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.value === avatarFile);
    });
    const dropdown = document.getElementById('iig_user_avatar_dropdown');
    if (dropdown) dropdown.classList.remove('open');

    // Ава {{user}} сменилась → панель «Внешность (ориг. аватар)» и инъекция внешности следуют за ней.
    iigUserDescPersona = null;
    try { renderAvatarAppearancePanel('user'); } catch (e) { iigLog('WARN', 'appearance panel refresh failed:', e.message); }
    try { updateAvatarAppearanceInjection(); } catch (e) {}
}

// NPC-матчинг «по-новому» (порт из novarakk/megarakk): по полному имени + алиасам,
// по границам слов (как лорбук-триггеры) — без ложных срабатываний внутри слов.
// Уважает per-NPC тумблер enabled. NPC участвует, если может помочь генерации:
// есть картинка ИЛИ текст внешности (description) — текст работает и без фото.
function matchNpcReferences(prompt, npcList) {
    if (!prompt || !Array.isArray(npcList) || npcList.length === 0) return [];
    const matched = [];
    for (const npc of npcList) {
        if (!npc || npc.enabled === false || !npc.name) continue;
        const hasImage = !!(npc.imagePath || npc.imageBase64);
        const hasDesc = !!String(npc.description || '').trim();
        if (!hasImage && !hasDesc) continue;
        const triggers = [npc.name, ...(Array.isArray(npc.aliases) ? npc.aliases : [])]
            .map(s => String(s || '').trim()).filter(Boolean);
        const hit = triggers.some(tr => promptContainsReferenceName(prompt, tr));
        if (hit) {
            matched.push({
                name: npc.name,
                aliases: Array.isArray(npc.aliases) ? npc.aliases : [],
                imageBase64: npc.imageBase64 || '',
                imagePath: npc.imagePath || '',
                description: String(npc.description || ''),
            });
        }
    }
    return matched;
}

// ── Ключи сущностей ───────────────────────────────────────────────
// {{char}} → файл аватара карточки (уникален, переживает переименование);
// {{user}} → текущая персона ST (user_avatar). '' если не на ком закрепить (нет чата / группа).
function getCharKey() {
    const ctx = SillyTavern.getContext();
    const c = (ctx.characterId !== undefined && ctx.characterId !== null) ? ctx.characters?.[ctx.characterId] : null;
    return c?.avatar || '';
}
function getPersonaKey() {
    // Явно выбранная в выпадашке ава (userAvatarFile) главнее авто-персоны ST:
    // описание внешности следует за той авой, чья картинка реально уходит референсом.
    const file = getSettings().userAvatarFile;
    if (file) return file;
    // Никогда не пусто: без активной персоны — стабильный дефолт, чтобы запись внешности не терялась.
    return SillyTavern.getContext().user_avatar || '__default_persona__';
}
// Какую персону сейчас редактируем в UI (селектор). null → активная персона.
let iigUserDescPersona = null;
function iigCurrentUserDescKey() { return iigUserDescPersona || getPersonaKey(); }
function iigPersonaLabel(key) {
    const ctx = SillyTavern.getContext();
    if (key === '__default_persona__') return 'Персона по умолчанию';
    if (key === getPersonaKey()) return `${ctx.name1 || key} (активная)`;
    return key;
}
// Опции селектора персон: активная + все, у кого уже есть описание (+ текущая выбранная).
function iigBuildPersonaOptionsHtml(selectedKey) {
    const s = getSettings();
    const keys = [];
    const add = (k) => { k = String(k || '').trim(); if (k && !keys.includes(k)) keys.push(k); };
    add(getPersonaKey());
    for (const k of Object.keys(s.userDescByKey || {})) add(k);
    add(selectedKey);
    return keys.map(k => `<option value="${sanitizeForHtml(k)}" ${k === selectedKey ? 'selected' : ''}>${sanitizeForHtml(iigPersonaLabel(k))}</option>`).join('');
}
function _emptyRef() { return { name: '', imageBase64: '', imagePath: '' }; }
function _refHasImage(r) { return !!(r && (r.imagePath || r.imageBase64)); }

// Разовая миграция старого глобального {{char}} в per-character карту.
// {{user}} НЕ мигрируем в карты — он остаётся глобальным (см. migrateUserBackToGlobal).
function migratePerCharOnce() {
    const s = getSettings();
    const ck = getCharKey();
    // {{char}} мигрируем только когда есть ключ перса — иначе на welcome-экране (перс не открыт)
    // можно было бы стереть глобальное описание {{char}} до переноса.
    if (!s._charMigrated && ck) {
        s.charDescByKey = s.charDescByKey || {};
        s.charRefByKey = s.charRefByKey || {};
        if (s.charDescription && s.charDescByKey[ck] === undefined) s.charDescByKey[ck] = s.charDescription;
        if (_refHasImage(s.charRef) && !s.charRefByKey[ck]) s.charRefByKey[ck] = s.charRef;
        s.charDescription = ''; s.charRef = _emptyRef();
        s._charMigrated = true;
        saveSettings();
    }
}

// {{user}} описание — per-persona (userDescByKey по аватару персоны). Фото {{user}} — глобальное.
// Разовая миграция: переносит остаток глобального userDescription на активную персону и
// поднимает глобальное фото из per-persona карты, если оно там осталось (прямой апгрейд).
function migrateUserToPerPersona() {
    const s = getSettings();
    if (s._userPerPersonaV2) return;
    s.userDescByKey = s.userDescByKey || {};
    const pk = getPersonaKey();
    // Описание: лишнее глобальное значение переносим активной персоне, если у неё пусто.
    if (String(s.userDescription || '').trim() && !String(s.userDescByKey[pk] || '').trim()) {
        s.userDescByKey[pk] = s.userDescription;
    }
    s.userDescription = '';
    // Фото остаётся глобальным: если глобальный userRef пуст, поднимем картинку из карты.
    if (!_refHasImage(s.userRef) && s.userRefByKey && typeof s.userRefByKey === 'object') {
        const pickRef = _refHasImage(s.userRefByKey[pk]) ? s.userRefByKey[pk]
            : Object.values(s.userRefByKey).find(r => _refHasImage(r));
        if (pickRef) s.userRef = { name: pickRef.name || '', imageBase64: pickRef.imageBase64 || '', imagePath: pickRef.imagePath || '' };
    }
    s._userPerPersonaV2 = true;
    saveSettings();
}

// {{char}} внешность — per-character (карта по аватару карточки).
function getCharDescription() { const s = getSettings(); const k = getCharKey(); return (k && s.charDescByKey?.[k]) || ''; }
function setCharDescription(v) {
    const s = getSettings(); const k = getCharKey(); if (!k) return;
    if (!s.charDescByKey) s.charDescByKey = {};
    if (v && v.trim()) s.charDescByKey[k] = v; else delete s.charDescByKey[k];
    saveSettings();
}
// {{user}} внешность — per-persona (карта userDescByKey по аватару персоны ST).
// Селектор в UI редактирует любую персону; на генерации берётся активная (getPersonaKey).
function getUserDescriptionFor(key) { const k = String(key || '') || getPersonaKey(); return String(getSettings().userDescByKey?.[k] || ''); }
function setUserDescriptionFor(key, v) {
    const s = getSettings();
    const k = String(key || '') || getPersonaKey();
    if (!s.userDescByKey) s.userDescByKey = {};
    const val = String(v || '');
    if (val.trim()) s.userDescByKey[k] = val; else delete s.userDescByKey[k];
    saveSettings();
}
function getUserDescription() { return getUserDescriptionFor(getPersonaKey()); }
function setUserDescription(v) { setUserDescriptionFor(getPersonaKey(), v); }

function getCurrentCharacterRefs() {
    const settings = getSettings();
    if (!settings.charRefByKey) settings.charRefByKey = {};
    if (!settings.userRefByKey) settings.userRefByKey = {};
    if (!Array.isArray(settings.npcReferences)) settings.npcReferences = [];
    migratePerCharOnce();
    migrateUserToPerPersona();
    // {{char}} — привязка плоского .charRef к записи текущего перса ПО ССЫЛКЕ (per-character).
    // {{user}} — .userRef ГЛОБАЛЬНЫЙ (один объект на всех), просто гарантируем его существование.
    const ck = getCharKey();
    settings.charRef = ck ? (settings.charRefByKey[ck] || (settings.charRefByKey[ck] = _emptyRef())) : _emptyRef();
    if (!settings.userRef || typeof settings.userRef !== 'object' || Array.isArray(settings.userRef)) settings.userRef = _emptyRef();
    return settings;
}

/* ═══════════════════════════════════════════════════════════════
   Avatar Library — порт 1:1 из megarakk.
   Кастомные аватары char/user: элемент {id, name, imageData(base64), target, appearance}.
   Активный элемент (activeAvatarChar/activeAvatarUser) даёт картинку-референс И текст внешности.
   Хранится по СТАБИЛЬНОМУ id (makeAvatarId), а НЕ по волатильному ключу персоны/персонажа —
   поэтому ввод всегда сохраняется и читается.
   ═══════════════════════════════════════════════════════════════ */
function makeAvatarId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function ensureAvatarItems(settings = getSettings()) {
    if (!Array.isArray(settings.avatarItems)) settings.avatarItems = [];
    for (const item of settings.avatarItems) if (item && !Object.hasOwn(item, 'appearance')) item.appearance = '';
    return settings.avatarItems;
}
function addAvatarItem(name, imageData, target = 'char') {
    const settings = getSettings();
    const items = ensureAvatarItems(settings);
    const item = {
        id: makeAvatarId('ava'),
        name: String(name || '').trim() || 'Avatar',
        imageData,
        target: target === 'user' ? 'user' : 'char',
        appearance: '',
        createdAt: Date.now(),
    };
    items.push(item);
    // Первый аватар для стороны делаем активным, чтобы заработал сразу.
    const key = item.target === 'user' ? 'activeAvatarUser' : 'activeAvatarChar';
    if (!settings[key]) settings[key] = item.id;
    saveSettings();
    return item;
}
function removeAvatarItem(itemId) {
    const settings = getSettings();
    if (settings.activeAvatarChar === itemId) settings.activeAvatarChar = null;
    if (settings.activeAvatarUser === itemId) settings.activeAvatarUser = null;
    settings.avatarItems = ensureAvatarItems(settings).filter(a => a.id !== itemId);
    saveSettings();
}
function setActiveAvatar(itemId, target) {
    const settings = getSettings();
    const key = target === 'user' ? 'activeAvatarUser' : 'activeAvatarChar';
    settings[key] = settings[key] === itemId ? null : itemId; // повторный клик снимает активность
    saveSettings();
    updateAvatarAppearanceInjection();
    return settings[key];
}
function getActiveAvatarItem(target, settings = getSettings()) {
    const id = target === 'user' ? settings.activeAvatarUser : settings.activeAvatarChar;
    if (!id) return null;
    return ensureAvatarItems(settings).find(a => a.id === id) || null;
}
function updateAvatarItemAppearance(itemId, appearance) {
    const settings = getSettings();
    const item = ensureAvatarItems(settings).find(a => a.id === itemId);
    if (!item) return null;
    item.appearance = String(appearance || '');
    saveSettings();
    updateAvatarAppearanceInjection();
    return item;
}
// Картинка активного аватара (base64) для подмены дефолтного аватара char/user.
function getActiveAvatarOverrideBase64(target) {
    try { return getActiveAvatarItem(target)?.imageData || null; } catch (_) { return null; }
}
async function generateAvatarItemAppearance(itemId) {
    const item = ensureAvatarItems().find(a => a.id === itemId);
    if (!item?.imageData) throw new Error('Нет картинки у этого аватара');
    const prompt = "Describe this character's physical appearance in detail for consistent image generation. Focus on: face features, eye color, hair color and style, skin tone, body type, distinctive features. Be concise but thorough (2-4 sentences). Write in English.";
    const description = await callVisionApi(item.imageData, prompt);
    updateAvatarItemAppearance(itemId, description);
    return description;
}
// Инъекция описания внешности активных аватаров в LLM-контекст (setExtensionPrompt).
function updateAvatarAppearanceInjection() {
    try {
        const context = SillyTavern.getContext();
        const settings = getSettings();
        const injectionKey = `${MODULE_NAME}_avatar_appearance`;
        if (typeof context.setExtensionPrompt !== 'function') return;
        if (!settings.injectAvatarAppearanceToChatEnabled) { context.setExtensionPrompt(injectionKey, '', 0, 0); return; }
        const parts = [];
        // Активный аватар библиотеки → его внешность; не выбран → описание ориг. аватара ST (per-char/per-persona).
        const charItem = getActiveAvatarItem('char', settings);
        const charApp = charItem ? String(charItem.appearance || '').trim() : getCharDescription().trim();
        if (charApp) { const cn = context.characters?.[context.characterId]?.name || 'Character'; parts.push(`[${cn} looks like: ${charApp}]`); }
        const userItem = getActiveAvatarItem('user', settings);
        const userApp = userItem ? String(userItem.appearance || '').trim() : getUserDescription().trim();
        if (userApp) { const un = context.name1 || 'User'; parts.push(`[${un} looks like: ${userApp}]`); }
        const depth = Number.isFinite(settings.avatarAppearanceInjectionDepth) ? settings.avatarAppearanceInjectionDepth : 1;
        context.setExtensionPrompt(injectionKey, parts.join('\n'), 1, depth);
    } catch (e) { iigLog('ERROR', 'avatar appearance injection error:', e.message); }
}
// Файл → resized base64 (без data: префикса), для добавления аватара в библиотеку.
// withCrop — сначала предложить кадрирование (отмена диалога = картинка целиком).
async function iigFileToResizedBase64(file, maxDim = 512, withCrop = false) {
    let dataUrl = await iigFileToDataUrl(file);
    if (withCrop) dataUrl = await iigCropImageDialog(dataUrl);
    return await compressBase64Image(dataUrl.split(',')[1], maxDim, 0.85);
}

function persistRefsToLocalStorage() {
    try {
        const settings = getSettings();
        const payload = {
            charRefByKey: settings.charRefByKey || {},
            userRefByKey: settings.userRefByKey || {},
            charDescByKey: settings.charDescByKey || {},
            userDescByKey: settings.userDescByKey || {},
            userRef: settings.userRef || {},           // {{user}} — глобальные
            userDescription: settings.userDescription || '',
            npcReferences: settings.npcReferences,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch(e) {
        iigLog('WARN', 'persistRefsToLocalStorage failed:', e.message);
    }
}

function restoreRefsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const backup = JSON.parse(raw);
        if (!backup || typeof backup !== 'object') return;
        const settings = getSettings();
        if (backup.charRefByKey) settings.charRefByKey = backup.charRefByKey;
        if (backup.userRefByKey) settings.userRefByKey = backup.userRefByKey;
        if (backup.charDescByKey) settings.charDescByKey = backup.charDescByKey;
        if (backup.userDescByKey) settings.userDescByKey = backup.userDescByKey;
        // {{user}} — глобальные поля.
        if (backup.userRef) settings.userRef = backup.userRef;
        if (typeof backup.userDescription === 'string') settings.userDescription = backup.userDescription;
        // charRef из старого формата — временное поле, миграция {{char}} перенесёт в карту.
        if (backup.charRef) settings.charRef = backup.charRef;
        if (backup.npcReferences) settings.npcReferences = backup.npcReferences;
        iigLog('INFO', 'Refs restored from localStorage');
    } catch(e) {
        iigLog('WARN', 'restoreRefsFromLocalStorage failed:', e.message);
    }
}

function initMobileSaveListeners() {
    const flush = () => {
        persistRefsToLocalStorage();
        try { SillyTavern.getContext().saveSettingsDebounced(); } catch(e) {}
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
}

/**
 * Load a ref's base64 from path or inline data.
 */
async function getRefBase64(ref, label) {
    if (ref?.imagePath) {
        const b64 = await loadRefImageAsBase64(ref.imagePath);
        if (b64) { iigLog('INFO', `${label}: loaded from path`); return b64; }
    }
    if (ref?.imageBase64) return ref.imageBase64;
    return null;
}

/**
 * Load a ref as data URL.
 */
async function getRefDataUrl(ref) {
    if (ref?.imagePath) {
        const b64 = await loadRefImageAsBase64(ref.imagePath);
        if (b64) return 'data:image/jpeg;base64,' + b64;
    }
    if (ref?.imageBase64) return 'data:image/jpeg;base64,' + ref.imageBase64;
    return null;
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

    // Зеркала текущего свайпа — иначе после свайпа туда-обратно возвращается
    // старый тег ([IMG:GEN]/старый src) и картинка «пропадает».
    const swipeId = message.swipe_id;
    if (swipeId !== undefined) {
        if (Array.isArray(message.swipes) && typeof message.swipes[swipeId] === 'string') {
            message.swipes[swipeId] = message.swipes[swipeId].replace(tag.fullMatch, replacement);
        }
        const swipeExtra = message.swipe_info?.[swipeId]?.extra;
        if (swipeExtra?.display_text) {
            swipeExtra.display_text = swipeExtra.display_text.replace(tag.fullMatch, replacement);
        }
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

        // ElectronHub: фильтруем по полю `endpoints` — это правильный фильтр от самого провайдера.
        // Модель попадает в список если у неё среди endpoints есть /images/generations или /images/edits.
        if (settings.apiType === 'electronhub') {
            const filtered = models.filter((m) => {
                const eps = Array.isArray(m?.endpoints) ? m.endpoints.map(String) : null;
                if (eps && eps.length > 0) {
                    return eps.some((e) =>
                        e.includes('/images/generations') || e.includes('/images/edits'),
                    );
                }
                // Если у модели нет поля endpoints — фолбэк на keyword-фильтр
                return isImageModel(m.id);
            }).map(m => m.id).filter(Boolean);
            return settings.showAllModels ? models.map(m => m.id).filter(Boolean).sort() : filtered;
        }

        // Если включён showAllModels — отдаём всё (юзер сам выберет),
        // иначе фильтруем по image-keywords.
        if (settings.showAllModels) {
            return models.map(m => m.id).filter(Boolean).sort();
        }
        return models.filter(m => isImageModel(m.id)).map(m => m.id);
    } catch (error) {
        console.error('[IIG] Failed to fetch models:', error);
        toastr.error(`Ошибка загрузки моделей: ${error.message}`, 'Генерация картинок');
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
 * Generate image via OpenAI-compatible endpoint
 */
// ───────────────────────────────────────────────────────────────────────
// ElectronHub — OpenAI-совместимый агрегатор с расширенными параметрами
// ───────────────────────────────────────────────────────────────────────
// Особенности vs стандартный OpenAI:
//   - своя система размеров, разная для NAI/SD/Flux
//   - доп. параметры: style, negative_prompt, guidance_scale, steps
//   - response_format всегда b64_json
//   - /v1/models возвращает поле endpoints — фильтруем правильно
//   - длинный таймаут (некоторые модели генерят минутами)
// Документация: https://docs.electronhub.ai/examples/image-examples

const ELECTRONHUB_REQUEST_TIMEOUT_MS = 600_000; // 10 минут

/**
 * Конвертирует aspect_ratio → size для конкретной модели ElectronHub.
 * Разные семейства моделей поддерживают разные конкретные размеры.
 */
function electronHubAspectToSize(aspect, modelId) {
    if (!aspect) return null;
    const mid = String(modelId || '').toLowerCase();

    // NAI Diffusion models (nai-diffusion-*)
    if (mid.includes('nai-diffusion')) {
        const map = {
            '1:1': '1024x1024', '1:2': '512x1024', '2:1': '1024x512',
            '2:3': '832x1216', '3:2': '1216x832',
            '9:16': '704x1280', '16:9': '1280x704',
            '3:4': '768x1024', '4:3': '1024x768',
        };
        return map[aspect] || '1024x1024';
    }

    // Stable Diffusion / SDXL
    if (mid.includes('sd-') || mid.includes('sdxl-') || mid.includes('stable-diffusion')) {
        const map = {
            '1:1': '1024x1024',
            '16:9': '1536x864', '9:16': '864x1536',
            '3:2': '1536x1024', '2:3': '1024x1536',
            '4:3': '1536x1152', '3:4': '1152x1536',
            '21:9': '1792x768',
        };
        return map[aspect] || '1024x1024';
    }

    // Flux family
    if (mid.includes('flux')) {
        const map = {
            '1:1': '1024x1024',
            '16:9': '1344x768', '9:16': '768x1344',
            '3:2': '1216x832',  '2:3': '832x1216',
            '4:3': '1152x896',  '3:4': '896x1152',
        };
        return map[aspect] || '1024x1024';
    }

    // Generic fallback
    const map = {
        '1:1': '1024x1024',
        '16:9': '1536x864', '9:16': '864x1536',
        '3:2': '1536x1024', '2:3': '1024x1536',
        '4:3': '1536x1152', '3:4': '1152x1536',
    };
    return map[aspect] || '1024x1024';
}

/**
 * Generate image via ElectronHub.
 * Использует /v1/images/generations с расширенными параметрами.
 * Референсы по умолчанию НЕ поддерживаются — большинство моделей не имеют /v1/images/edits.
 * Включается флагом settings.electronhubEnableReferences.
 */
async function generateImageElectronHub(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const baseEndpoint = (settings.endpoint || DEFAULT_ENDPOINTS.electronhub).replace(/\/+$/, '');

    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    // Размер — приоритет: aspectRatio из тега → settings.aspectRatio → settings.size
    const aspect = options.aspectRatio || settings.aspectRatio;
    const sizeFromAspect = electronHubAspectToSize(aspect, settings.model);
    const size = sizeFromAspect || settings.size || '1024x1024';

    const ehStyle = String(settings.electronhubStyle || '').trim();
    const negPrompt = String(settings.electronhubNegativePrompt || '').trim();
    const guidance = parseFloat(settings.electronhubGuidanceScale);
    const steps = parseInt(settings.electronhubSteps, 10);

    const useEdits = referenceImages.length > 0 && settings.electronhubEnableReferences;
    const url = options.overrideUrl
        || (useEdits ? `${baseEndpoint}/v1/images/edits` : `${baseEndpoint}/v1/images/generations`);

    iigLog('INFO', `ElectronHub: model=${settings.model} mode=${useEdits ? 'edits' : 'generations'} size=${size} style=${ehStyle || '(none)'} refs=${referenceImages.length}${settings.electronhubEnableReferences ? '/enabled' : '/disabled'}`);

    let init;

    if (useEdits) {
        // ElectronHub /edits ожидает multipart, single `image` (mosт моделей не имеют image[])
        const form = new FormData();
        form.append('model', settings.model);
        form.append('prompt', fullPrompt);
        form.append('n', '1');
        form.append('size', size);
        form.append('response_format', 'b64_json');
        if (ehStyle) form.append('style', ehStyle);
        if (negPrompt) form.append('negative_prompt', negPrompt);
        if (Number.isFinite(guidance) && guidance > 0) form.append('guidance_scale', String(guidance));
        if (Number.isFinite(steps) && steps > 0) form.append('steps', String(steps));
        form.append('image', iigBase64ToBlob(referenceImages[0], 'image/png'), 'reference-0.png');

        init = {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.apiKey}` },
            body: form,
        };
    } else {
        const body = {
            model: settings.model,
            prompt: fullPrompt,
            n: 1,
            size,
            response_format: 'b64_json',
        };
        if (ehStyle) body.style = ehStyle;
        if (negPrompt) body.negative_prompt = negPrompt;
        if (Number.isFinite(guidance) && guidance > 0) body.guidance_scale = guidance;
        if (Number.isFinite(steps) && steps > 0) body.steps = steps;

        init = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        };
    }

    // fetch с таймаутом 10 минут
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ELECTRONHUB_REQUEST_TIMEOUT_MS);
    init.signal = controller.signal;
    // Кнопка «Остановить» обрывает запрос через тот же контроллер.
    if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }

    let response;
    try {
        response = await fetch(url, init);
    } catch (e) {
        clearTimeout(timeoutId);
        if (isGenerationCancelled(e, options.signal) && options.signal?.aborted) {
            throw options.signal.reason || e;
        }
        if (e.name === 'AbortError') {
            throw new Error(`ElectronHub: timeout after ${ELECTRONHUB_REQUEST_TIMEOUT_MS / 1000}s`);
        }
        // CORS/network on /edits — fall back to /generations without refs
        if (useEdits && e?.name === 'TypeError') {
            iigLog('WARN', `ElectronHub /edits unreachable (${e.message}). Falling back to /generations without references.`);
            try { toastr?.warning?.('Прокси не поддерживает /v1/images/edits — рефы пропущены.', 'ElectronHub', { timeOut: 6000 }); } catch (_) {}
            return await generateImageElectronHub(prompt, style, [], options);
        }
        throw e;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`ElectronHub Error (${response.status}): ${text}`);
    }

    const result = await response.json();
    const dataList = result.data || [];
    if (dataList.length === 0) {
        if (result.url) return result.url;
        throw new Error('ElectronHub: no image data in response');
    }

    const imageObj = dataList[0];
    if (imageObj.b64_json) return `data:image/png;base64,${imageObj.b64_json}`;
    if (imageObj.url) return imageObj.url;
    throw new Error('ElectronHub: no b64_json or url in response');
}

async function generateImageOpenAI(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const baseEndpoint = (settings.endpoint || '').replace(/\/$/, '');

    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    const modelKind = classifyOpenAIModel(settings.model);
    const isGptImg = isGptImageFamily(modelKind);
    const isFluxKontext = modelKind === 'flux-kontext';
    const isDallE2 = modelKind === 'dall-e-2';

    // Map aspect ratio → size for the model family
    let size = settings.size;
    if (options.aspectRatio) {
        size = openAIAspectToSize(options.aspectRatio, modelKind) || size;
    }

    const quality = normalizeOpenAIQuality(options.quality || settings.quality, modelKind);

    // Routing: if we have references AND model supports /edits → multipart
    const supportsEdits = isGptImg || isFluxKontext || isDallE2;
    const wantsEdits = referenceImages.length > 0 && supportsEdits;

    iigLog('INFO', `OpenAI generate: model=${settings.model} kind=${modelKind} refs=${referenceImages.length} mode=${wantsEdits ? 'edits' : 'generations'} size=${size || '(auto)'} quality=${quality || '(auto)'}`);

    let url;
    let init;

    if (wantsEdits) {
        url = options.overrideUrl || `${baseEndpoint}/v1/images/edits`;
        const form = new FormData();
        form.append('model', settings.model);
        form.append('prompt', fullPrompt);
        form.append('n', '1');
        if (size) form.append('size', size);
        if (quality) form.append('quality', quality);

        // gpt-image-* supports multi-image via image[]; flux-kontext / dall-e-2 → single image
        if (isGptImg && referenceImages.length > 1) {
            referenceImages.forEach((b64, idx) => {
                form.append('image[]', iigBase64ToBlob(b64, 'image/png'), `reference-${idx}.png`);
            });
        } else {
            form.append('image', iigBase64ToBlob(referenceImages[0], 'image/png'), 'reference-0.png');
        }

        init = {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.apiKey}` },
            body: form,
        };
    } else {
        url = options.overrideUrl || `${baseEndpoint}/v1/images/generations`;
        const body = {
            model: settings.model,
            prompt: fullPrompt,
            n: 1,
        };
        if (size) body.size = size;
        if (quality) body.quality = quality;
        // gpt-image-* always returns b64 — sending response_format=b64_json triggers 400 on strict proxies.
        if (!isGptImg) body.response_format = 'b64_json';

        init = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        };
    }

    // Helper: chat-completions fallback that PRESERVES references
    const chatFallback = async (reason) => {
        iigLog('WARN', `OpenAI ${reason} — falling back to /v1/chat/completions (OpenRouter-style) with references.`);
        const fpStyled = style ? `[Style: ${style}] ${prompt}` : prompt;
        return await generateImageViaChatCompletions({
            settings,
            model: settings.model,
            fullPrompt: fpStyled,
            referenceImages,
            refLabels: options.refLabels || [],
            aspectRatio: options.aspectRatio || settings.aspectRatio,
            imageSize: settings.imageSize,
        });
    };

    // Кнопка «Остановить» обрывает сетевой запрос.
    if (options.signal && !init.signal) init.signal = options.signal;

    let response;
    try {
        response = await fetch(url, init);
    } catch (e) {
        if (isGenerationCancelled(e, options.signal)) throw e;
        // CORS/network error on /edits — most proxies (rout.my, openrouter, ...) don't expose /v1/images/edits.
        // Try /v1/chat/completions instead — same proxy almost always supports it WITH references.
        if (wantsEdits && e?.name === 'TypeError') {
            try { return await chatFallback(`/edits unreachable (${e.message})`); } catch (e2) {
                iigLog('WARN', `Chat-completions fallback failed: ${e2.message}. Last resort: /generations without refs.`);
                try { toastr?.warning?.('Прокси не поддерживает ни /v1/images/edits, ни /v1/chat/completions с картинками — рефы пропущены.', 'OpenAI', { timeOut: 7000 }); } catch (_) {}
                return await generateImageOpenAI(prompt, style, [], options);
            }
        }
        throw e;
    }

    if (!response.ok) {
        const text = await response.text();
        // Some proxies return 400 "Model name is required in path" / INVALID_ARGUMENT for /edits and /generations
        // when they actually route through chat completions. Try that path with refs.
        if (referenceImages.length > 0 &&
            (response.status === 400 || response.status === 404 || response.status === 405) &&
            /Model name is required|INVALID_ARGUMENT|not.found|method not allowed/i.test(text)) {
            try { return await chatFallback(`${response.status}: ${text.slice(0, 80)}`); } catch (e2) {
                throw new Error(`API Error (${response.status}): ${text}`);
            }
        }
        throw new Error(`API Error (${response.status}): ${text}`);
    }

    const result = await response.json();
    const dataList = result.data || [];
    if (dataList.length === 0) {
        if (result.url) return result.url;
        throw new Error('No image data in response');
    }
    const imageObj = dataList[0];
    if (imageObj.b64_json) return `data:image/png;base64,${imageObj.b64_json}`;
    if (imageObj.url) return imageObj.url;
    throw new Error('Response data[0] has no b64_json or url');
}

// ── OpenAI helpers ──
function classifyOpenAIModel(modelId) {
    const id = String(modelId || '').toLowerCase().trim();
    if (id.includes('gpt-image-2')) return 'gpt-image-2';
    if (id.includes('gpt-image-1.5') || id.includes('gpt-image-1-5')) return 'gpt-image-1.5';
    if (id.includes('gpt-image-1-mini')) return 'gpt-image-1-mini';
    if (id.includes('gpt-image-1')) return 'gpt-image-1';
    if (id.includes('gpt-image')) return 'gpt-image';
    if (id.includes('flux-1-kontext') || id.includes('flux.1-kontext')) return 'flux-kontext';
    if (id.includes('dall-e-3')) return 'dall-e-3';
    if (id.includes('dall-e-2')) return 'dall-e-2';
    return 'unknown';
}

function isGptImageFamily(kind) {
    return kind === 'gpt-image-2' || kind === 'gpt-image-1.5' || kind === 'gpt-image-1-mini'
        || kind === 'gpt-image-1' || kind === 'gpt-image';
}

function openAIAspectToSize(aspect, modelKind) {
    if (!aspect) return null;
    if (modelKind === 'gpt-image-2') {
        return ({ '1:1':'1024x1024','16:9':'2048x1152','9:16':'1152x2048','3:2':'1536x1024','2:3':'1024x1536','4:3':'1536x1152','3:4':'1152x1536' })[aspect] || null;
    }
    if (isGptImageFamily(modelKind)) {
        return ({ '1:1':'1024x1024','16:9':'1536x1024','9:16':'1024x1536','3:2':'1536x1024','2:3':'1024x1536','4:3':'1536x1024','3:4':'1024x1536' })[aspect] || null;
    }
    if (modelKind === 'dall-e-3') {
        return ({ '1:1':'1024x1024','16:9':'1792x1024','9:16':'1024x1792' })[aspect] || null;
    }
    if (modelKind === 'dall-e-2') return '1024x1024';
    return null;
}

function normalizeOpenAIQuality(userQuality, modelKind) {
    const q = String(userQuality || '').toLowerCase().trim();
    if (isGptImageFamily(modelKind)) {
        if (['low','medium','high','auto'].includes(q)) return q;
        if (q === 'hd') return 'high';
        if (q === 'standard') return 'medium';
        return 'auto';
    }
    if (modelKind === 'dall-e-3') return ['standard','hd'].includes(q) ? q : 'standard';
    if (modelKind === 'dall-e-2') return 'standard';
    return q || null;
}

// Convert raw base64 (no data: prefix) → Blob for FormData uploads.
function iigBase64ToBlob(base64, mimeType = 'image/png') {
    let s = String(base64 || '');
    // Tolerate data URLs accidentally passed in
    const comma = s.indexOf(',');
    if (s.startsWith('data:') && comma > 0) s = s.slice(comma + 1);
    const byteChars = atob(s);
    const len = byteChars.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
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
    // Strip OpenRouter-style provider prefixes ("google/", "anthropic/" etc.) — Google's native
    // /v1beta/models/{name}:generateContent expects a bare model id, otherwise returns 404.
    const rawModel = String(settings.model || '');
    const model = rawModel.includes('/') ? rawModel.split('/').pop() : rawModel;
    const url = options.overrideUrl || `${settings.endpoint.replace(/\/$/, '')}/v1beta/models/${model}:generateContent`;

    // Некоторые OpenAI-совместимые прокси гоняют banana-модели через /v1/chat/completions,
    // а не через нативный /v1beta generateContent (там у них 404). Такой маршрут включается
    // опцией forceChatCompletions и шлёт полный каталожный id модели ("google/...").
    const forceChatCompletions = !!options.forceChatCompletions;
    
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
            'char_ref': '⬇️ CHARACTER REFERENCE — copy this character\'s appearance exactly:',
            'user_ref': '⬇️ USER REFERENCE — copy this person\'s appearance exactly:',
            'npc_ref': '⬇️ NPC REFERENCE — copy this character\'s appearance exactly:',
            'lorebook_ref': '⬇️ LOREBOOK REFERENCE — reproduce this subject/item exactly:',
            'char_outfit': '⬇️ CHARACTER OUTFIT REFERENCE — copy this clothing:',
            'user_outfit': '⬇️ USER OUTFIT REFERENCE — copy this clothing:',
            'context': '⬇️ SCENE CONTEXT (for style/mood consistency):',
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
    const hasCharRefs = refLabels.some(l => l === 'char_ref' || l === 'user_ref' || l === 'npc_ref' || l === 'lorebook_ref');
    const hasOutfits = refLabels.some(l => l.endsWith('_outfit'));
    const hasContext = refLabels.includes('context');
    
    let refInstruction = '';
    if (referenceImages.length > 0) {
        const rules = [];
        if (hasCharRefs) {
            rules.push('CHARACTER CONSISTENCY: You MUST precisely replicate the facial features (face structure, eye color/shape, hair color/style/length, skin tone, facial hair, age) and overall appearance from the CHARACTER/USER/NPC REFERENCE images. These characters must be recognizable as the same people across all generated images. This is the HIGHEST priority.');
        }
        if (hasOutfits) {
            rules.push('OUTFIT ACCURACY: The characters must wear EXACTLY the clothing shown in the OUTFIT REFERENCE images — same garments, colors, fabrics, accessories. Do not invent or change any clothing details.');
        }
        if (hasContext) {
            rules.push('STYLE CONSISTENCY: Match the art style, lighting, color palette, and rendering quality of the CONTEXT reference images. The generated image should look like it belongs to the same series.');
        }
        if (!hasContext && style) {
            rules.push(`STYLE: Generate in "${style}" style consistently. Do not mix styles.`);
        }
        refInstruction = `[STRICT IMAGE GENERATION RULES]\n${rules.join('\n')}\n[END RULES]\n\n`;
    }
    
    // Add prompt with style and instruction
    let fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;
    fullPrompt = `${refInstruction}${fullPrompt}`;
    
    parts.push({ text: fullPrompt });
    
    const labelSummary = refLabels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {});
    console.log(`[IIG] Gemini request: ${referenceImages.length} refs (${JSON.stringify(labelSummary)}) + prompt (${fullPrompt.length} chars)`);

    // Обходной маршрут: мимо /v1beta, сразу в OpenAI-style chat completions.
    if (forceChatCompletions) {
        iigLog('INFO', `Chat-completions route for model=${rawModel}`);
        return await generateImageViaChatCompletions({
            settings,
            model: rawModel,           // полный каталожный id (сохраняем префикс "google/")
            fullPrompt,
            referenceImages,
            refLabels,
            aspectRatio,
            imageSize,
        });
    }

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
        body: JSON.stringify(body),
        signal: options.signal || undefined
    });

    if (!response.ok) {
        const text = await response.text();
        if (response.status === 404) {
            iigLog('WARN', `Gemini /v1beta returned 404 — falling back to OpenAI-compat /v1/chat/completions (OpenRouter-style).`);
            return await generateImageViaChatCompletions({
                settings,
                model: rawModel,           // keep "google/..." prefix — OpenRouter-style proxies expect it
                fullPrompt,
                referenceImages,
                refLabels,
                aspectRatio,
                imageSize,
            });
        }
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
 * Fallback for proxies that expose image-generation through OpenAI-compat /v1/chat/completions
 * (OpenRouter style). Used when /v1beta/...generateContent or /v1/images/edits returns 404/CORS/etc.
 */
async function generateImageViaChatCompletions({ settings, model, fullPrompt, referenceImages = [], refLabels = [], aspectRatio, imageSize }) {
    const url = `${settings.endpoint.replace(/\/$/, '')}/v1/chat/completions`;

    const labelMap = {
        'char_ref': '⬇️ CHARACTER REFERENCE — copy this character\'s appearance exactly:',
        'user_ref': '⬇️ USER REFERENCE — copy this person\'s appearance exactly:',
        'npc_ref': '⬇️ NPC REFERENCE — copy this character\'s appearance exactly:',
        'lorebook_ref': '⬇️ LOREBOOK REFERENCE — reproduce this subject/item exactly:',
        'char_outfit': '⬇️ CHARACTER OUTFIT REFERENCE — copy this clothing:',
        'user_outfit': '⬇️ USER OUTFIT REFERENCE — copy this clothing:',
        'context': '⬇️ SCENE CONTEXT (for style/mood consistency):',
    };

    // OpenRouter-style: text first, then images. Each ref preceded by a label.
    const content = [{ type: 'text', text: fullPrompt }];
    for (let i = 0; i < Math.min(referenceImages.length, MAX_GENERATION_REFERENCE_IMAGES); i++) {
        const lbl = labelMap[refLabels[i]] || '⬇️ REFERENCE IMAGE:';
        content.push({ type: 'text', text: lbl });
        content.push({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${referenceImages[i]}` },
        });
    }

    const body = {
        model,
        messages: [{ role: 'user', content }],
        modalities: ['image', 'text'],
    };
    const imageConfig = {};
    if (aspectRatio) imageConfig.aspect_ratio = aspectRatio;
    if (imageSize) imageConfig.image_size = imageSize;
    if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;

    iigLog('INFO', `Gemini-via-chat fallback: model=${model} refs=${referenceImages.length} aspect=${aspectRatio} size=${imageSize}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini-via-chat ${response.status}: ${String(text).slice(0, 400)}`);
    }

    const result = await response.json();
    const message = result?.choices?.[0]?.message;
    const images = Array.isArray(message?.images) ? message.images : [];
    const imageUrl = images[0]?.image_url?.url;
    if (typeof imageUrl === 'string' && imageUrl.length > 0) {
        return imageUrl; // already a data URL
    }
    // Some proxies return base64 directly in content
    if (typeof message?.content === 'string' && message.content.startsWith('data:image/')) {
        return message.content;
    }
    throw new Error('Gemini-via-chat: no image in response (choices[0].message.images empty)');
}
// Downscale a base64 PNG/JPEG to fit within maxSide px and re-encode as JPEG.
// Used as a last-resort fallback when HTTP/2 drops the connection on large bodies.
async function downscaleB64ForVoid(b64, maxSide = 768, quality = 0.82) {
    try {
        const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = src;
        });
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return b64;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const nw = Math.max(1, Math.round(w * scale));
        const nh = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, nw, nh);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        return dataUrl.split(',')[1];
    } catch (e) {
        return b64;
    }
}

async function generateImageVoid(prompt, style, referenceImages = [], options = {}) {
    const settings = getSettings();
    const url = options.overrideUrl || `${settings.endpoint.replace(/\/$/, '')}/v1/chat/completions`;
    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

    // Build message content. If we have reference images, use the multimodal
    // content array (OpenAI vision style) and prepend a labelled text part for
    // each reference so the model knows what it represents (char/user/NPC/etc.).
    const refLabels = options.refLabels || [];
    const labelMap = {
        'char_ref': '⬇️ CHARACTER REFERENCE — copy this character\'s appearance exactly:',
        'user_ref': '⬇️ USER REFERENCE — copy this person\'s appearance exactly:',
        'npc_ref': '⬇️ NPC REFERENCE — copy this character\'s appearance exactly:',
        'lorebook_ref': '⬇️ LOREBOOK REFERENCE — reproduce this subject/item exactly:',
        'char_outfit': '⬇️ CHARACTER OUTFIT REFERENCE — copy this clothing:',
        'user_outfit': '⬇️ USER OUTFIT REFERENCE — copy this clothing:',
        'context': '⬇️ SCENE CONTEXT (for style/mood consistency):',
    };

    // Downscale references disabled — sending originals
    let preparedRefs = [];
    if (referenceImages.length > 0) {
        const maxRefs = Math.min(referenceImages.length, MAX_GENERATION_REFERENCE_IMAGES);
        preparedRefs = referenceImages.slice(0, maxRefs);
        const totalBytes = preparedRefs.reduce((a, b) => a + (b?.length || 0), 0);
        iigLog('INFO', `Void refs prepared: ${preparedRefs.length} images, ~${Math.round(totalBytes / 1024)} KB base64 total`);
    }

    // Build the message-content array (text+images) for a given set of refs.
    const buildMessageContent = (refsArr, mime = 'image/png') => {
        if (refsArr.length === 0) return fullPrompt;
        const parts = [];
        for (let i = 0; i < refsArr.length; i++) {
            const label = refLabels[i] || 'reference';
            parts.push({ type: 'text', text: labelMap[label] || '⬇️ REFERENCE IMAGE:' });
            parts.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${refsArr[i]}` }
            });
        }
        const hasCharRefs = refLabels.some(l => l === 'char_ref' || l === 'user_ref' || l === 'npc_ref' || l === 'lorebook_ref');
        const hasOutfits = refLabels.some(l => l === 'char_outfit' || l === 'user_outfit');
        const hasContext = refLabels.includes('context');
        const rules = [];
        if (hasCharRefs) {
            rules.push('CHARACTER CONSISTENCY: You MUST precisely replicate the facial features (face structure, eye color/shape, hair color/style/length, skin tone, age) and overall appearance from the CHARACTER/USER/NPC REFERENCE images. These characters must be recognizable as the same people across all generated images.');
        }
        if (hasOutfits) {
            rules.push('OUTFIT ACCURACY: The characters must wear EXACTLY the clothing shown in the OUTFIT REFERENCE images — same garments, colors, fabrics, accessories.');
        }
        if (hasContext) {
            rules.push('STYLE CONSISTENCY: Match the art style, lighting, color palette and rendering of the CONTEXT reference images.');
        }
        const refInstruction = rules.length > 0
            ? `[STRICT IMAGE GENERATION RULES]\n${rules.join('\n')}\n[END RULES]\n\n`
            : '';
        parts.push({ type: 'text', text: `${refInstruction}${fullPrompt}` });
        return parts;
    };

    let messageContent = buildMessageContent(preparedRefs, 'image/png');
    if (preparedRefs.length > 0) {
        const labelSummary = refLabels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {});
        iigLog('INFO', `Void request: ${preparedRefs.length} refs (${JSON.stringify(labelSummary)}) + prompt (${fullPrompt.length} chars)`);
    }

    const buildBody = (content) => ({
        model: settings.model,
        messages: [{ role: 'user', content }],
        size: settings.size || '1024x1024',
        quality: options.quality || settings.quality || 'standard',
        n: 1
    });

    let response;
    let bodyJson = JSON.stringify(buildBody(messageContent));
    let bodySize = bodyJson.length;
    const baseFetchOpts = {
        method: 'POST',
        signal: options.signal || undefined,
        headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
    };

    // Pre-emptive downscale: payloads above ~1.5 MB reliably trigger
    // ERR_HTTP2_PROTOCOL_ERROR on voidai's Cloudflare frontend. Skip the
    // doomed attempts and shrink references right away.
    const PREEMPTIVE_DOWNSCALE_THRESHOLD = 1_500_000;
    let downscaled = false;
    if (preparedRefs.length > 0 && bodySize > PREEMPTIVE_DOWNSCALE_THRESHOLD) {
        iigLog('INFO', `Void: payload ~${Math.round(bodySize / 1024)} KB exceeds ${Math.round(PREEMPTIVE_DOWNSCALE_THRESHOLD / 1024)} KB threshold, pre-downscaling refs to 768px JPEG`);
        const small = [];
        for (const r of preparedRefs) {
            small.push(await downscaleB64ForVoid(r, 768, 0.82));
        }
        preparedRefs = small;
        downscaled = true;
        messageContent = buildMessageContent(preparedRefs, 'image/jpeg');
        bodyJson = JSON.stringify(buildBody(messageContent));
        bodySize = bodyJson.length;
        iigLog('INFO', `Void: downscaled payload ~${Math.round(bodySize / 1024)} KB`);
    }

    // Network-level retry strategy:
    //   attempt 0: payload as-is (already downscaled if it was huge)
    //   attempt 1: same payload, brief delay (transient HTTP/2 hiccup)
    //   attempt 2: downscale (if not already) — last-resort rescue
    let lastFetchErr;
    for (let netAttempt = 0; netAttempt < 3; netAttempt++) {
        try {
            response = await fetch(url, { ...baseFetchOpts, body: bodyJson });
            lastFetchErr = null;
            break;
        } catch (err) {
            if (isGenerationCancelled(err, options.signal)) throw err;
            lastFetchErr = err;
            const msg = String(err?.message || err);
            iigLog('WARN', `Void fetch attempt ${netAttempt + 1} failed: ${msg} (~${Math.round(bodySize / 1024)} KB)`);
            if (netAttempt === 0) {
                await new Promise(r => setTimeout(r, 600));
                continue;
            }
            if (netAttempt === 1 && preparedRefs.length > 0 && !downscaled) {
                iigLog('WARN', `Void: downscaling ${preparedRefs.length} reference(s) to 768px JPEG and retrying...`);
                const small = [];
                for (const r of preparedRefs) {
                    small.push(await downscaleB64ForVoid(r, 768, 0.82));
                }
                preparedRefs = small;
                downscaled = true;
                messageContent = buildMessageContent(preparedRefs, 'image/jpeg');
                bodyJson = JSON.stringify(buildBody(messageContent));
                bodySize = bodyJson.length;
                iigLog('INFO', `Void: downscaled payload ~${Math.round(bodySize / 1024)} KB`);
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        }
    }
    if (lastFetchErr) {
        const msg = String(lastFetchErr?.message || lastFetchErr);
        throw new Error(`Void: сетевая ошибка (${msg}). Размер запроса ~${Math.round(bodySize / 1024)} KB.`);
    }
    if (!response.ok) { const text = await response.text(); throw new Error(`API Error (${response.status}): ${text}`); }
    const result = await response.json();

    const toStr = (v) => (typeof v === 'string' ? v : null);
    const normalize = (val) => {
        if (!val || typeof val !== 'string') return null;
        if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:')) return val;
        // bare base64
        if (/^[A-Za-z0-9+/=\s]+$/.test(val) && val.length > 100) return `data:image/png;base64,${val.replace(/\s+/g, '')}`;
        return null;
    };
    const extractFromImgObj = (img) => {
        if (!img) return null;
        if (typeof img === 'string') return normalize(img);
        const candidates = [
            toStr(img.b64_json) && `data:image/png;base64,${img.b64_json}`,
            toStr(img.image_url?.url),
            toStr(typeof img.image_url === 'string' ? img.image_url : null),
            toStr(img.url),
            toStr(img.base64) && `data:image/png;base64,${img.base64}`,
            toStr(img.data) && (img.data.startsWith('data:') || img.data.startsWith('http') ? img.data : `data:image/png;base64,${img.data}`),
            toStr(img.src),
        ].filter(Boolean);
        for (const c of candidates) { const n = normalize(c) || c; if (n) return n; }
        return null;
    };
    const extractFromText = (text) => {
        if (!text || typeof text !== 'string') return null;
        // markdown image: ![alt](url)
        const md = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/i);
        if (md) return md[1];
        // raw url / data url anywhere in text
        const data = text.match(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/);
        if (data) return data[0];
        const url = text.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i);
        if (url) return url[0];
        return null;
    };

    // 1. OpenAI-style top-level data array
    if (result.data?.length > 0) {
        const got = extractFromImgObj(result.data[0]);
        if (got) return got;
    }
    // 2. Chat-completion choices
    const choice = result.choices?.[0];
    if (choice) {
        const imgList = choice.message?.images || choice.images || result.images || [];
        if (imgList.length > 0) {
            const got = extractFromImgObj(imgList[0]);
            if (got) return got;
        }
        // message.content can be string OR array of parts
        const content = choice.message?.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (!part) continue;
                if (part.type === 'image_url') {
                    const got = extractFromImgObj(part);
                    if (got) return got;
                }
                if (part.type === 'image' && part.source?.data) {
                    return `data:${part.source.media_type || 'image/png'};base64,${part.source.data}`;
                }
                if (typeof part.text === 'string') {
                    const got = extractFromText(part.text);
                    if (got) return got;
                }
            }
        } else if (typeof content === 'string') {
            const got = extractFromText(content);
            if (got) return got;
        }
    }
    // 3. Root-level fallbacks
    const rootCandidate = extractFromImgObj(result) || extractFromText(toStr(result.text) || toStr(result.message));
    if (rootCandidate) return rootCandidate;

    // 4. Last-resort regex over raw JSON
    const raw = JSON.stringify(result);
    const b64match = raw.match(/"b64_json"\s*:\s*"([^"]+)"/);
    if (b64match) return `data:image/png;base64,${b64match[1]}`;
    const dataUrlMatch = raw.match(/"(data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+)"/);
    if (dataUrlMatch) return dataUrlMatch[1];
    const urlmatch = raw.match(/"(https?:\/\/[^"\s]+\.(?:png|jpe?g|webp|gif)(?:\?[^"\s]*)?)"/i);
    if (urlmatch) return urlmatch[1];

    iigLog('ERROR', `VoidAI response had no image. Raw response (first 2000 chars): ${raw.slice(0, 2000)}`);

    // Diagnose common "model returned empty" cases so the error is actionable
    const ch = result.choices?.[0];
    const finish = ch?.finish_reason || ch?.finishReason || '';
    const content = ch?.message?.content;
    const isEmptyContent = content === null || content === undefined
        || (typeof content === 'string' && content.trim() === '')
        || (Array.isArray(content) && content.length === 0);
    const reasoningTokens = result.usage?.completion_tokens_details?.reasoning_tokens;
    const completionTokens = result.usage?.completion_tokens;
    if (isEmptyContent) {
        const hint = reasoningTokens > 0 && completionTokens === 0
            ? ` Модель потратила ${reasoningTokens} reasoning-токенов, но не вернула изображение (отказ или внутренний фильтр провайдера).`
            : '';
        throw new Error(
            `Void: модель "${settings.model}" вернула пустой ответ (finish_reason="${finish}", content=null).${hint} `
            + `Это сбой на стороне провайдера, попробуйте другую модель или повторите запрос.`
        );
    }
    throw new Error('Void: не удалось найти изображение в ответе (см. консоль для сырого JSON)');
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

    const fullPrompt = style ? `[Style: ${style}] ${prompt}` : prompt;

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
            body: JSON.stringify(body),
            signal: options.signal || undefined
        });
    } catch (error) {
        if (isGenerationCancelled(error, options.signal)) throw error;
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
        if (settings.apiType !== 'naistera' && settings.apiType !== 'custom') {
            errors.push('URL эндпоинта не настроен');
        }
    }
    if (!settings.apiKey) {
        errors.push('API ключ не настроен');
    }
    if (settings.apiType !== 'naistera' && settings.apiType !== 'custom' && !settings.model) {
        errors.push('Модель не выбрана');
    }
    if (settings.apiType === 'custom') {
        const fmt = settings.customRequestFormat || 'openai';
        if (!settings.customFullUrl && !settings.endpoint) {
            errors.push('Для Custom: укажите Эндпоинт или Полный URL');
        }
        if (fmt !== 'naistera' && !settings.model) {
            errors.push('Для Custom (' + fmt + '): модель не выбрана');
        }
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
 * Активный образ гардероба стороны ('bot'|'user') для референсов генерации.
 * tryOn=true — картинка образа является ИИ-примеркой (человек уже В наряде):
 * такую отправляем КАК аватар-референс вместо пары «аватар + наряд» — модель
 * не путает, чья одежда, и уходит один слот референсов вместо двух.
 * usedAsAvatar проставляет вызывающий код, чтобы не отправить картинку дважды.
 */
async function getWardrobeOutfitRef(side) {
    const sw = window.sillyWardrobe;
    if (!sw?.isReady()) return null;
    const b64 = sw.getActiveOutfitBase64Async ? await sw.getActiveOutfitBase64Async(side) : sw.getActiveOutfitBase64(side);
    if (!b64) return null;
    return { b64, tryOn: !!sw.isActiveOutfitTryOn?.(side), usedAsAvatar: false };
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
    
    // Collect reference images (provider-specific) using unified refs
    const referenceImages = [];
    const referenceDataUrls = [];
    const refLabels = [];
    const refs = getCurrentCharacterRefs();

    // Gemini/nano-banana references: PRIORITY ORDER — chars first, outfits second, context last
    if (usesGeminiRoute(settings)) {
        // Активные образы гардероба — заранее: образ-примерка подменяет собой аватар-референс.
        const botOutfit = await getWardrobeOutfitRef('bot');
        const userOutfit = await getWardrobeOutfitRef('user');
        // 1. Character reference (примерка образа → ручной charRef → Avatar Library → ST аватар) — ТОЛЬКО если включено
        if (settings.sendCharAvatar) {
            if (botOutfit?.tryOn) {
                referenceImages.push(botOutfit.b64); refLabels.push('char_ref'); botOutfit.usedAsAvatar = true;
            } else {
                const charB64 = await getRefBase64(refs.charRef, 'charRef') || await getCharacterAvatarBase64();
                if (charB64) { referenceImages.push(charB64); refLabels.push('char_ref'); }
            }
        }
        // 2. User reference (примерка образа → ручной userRef → Avatar Library → ST персона) — ТОЛЬКО если включено
        if (settings.sendUserAvatar) {
            if (userOutfit?.tryOn) {
                referenceImages.push(userOutfit.b64); refLabels.push('user_ref'); userOutfit.usedAsAvatar = true;
            } else {
                const userB64 = await getRefBase64(refs.userRef, 'userRef') || await getUserAvatarBase64();
                if (userB64) { referenceImages.push(userB64); refLabels.push('user_ref'); }
            }
        }
        // 3. NPC references (auto-matched by name in prompt)
        const matchedNpcs = matchNpcReferences(prompt, refs.npcReferences);
        for (const npc of matchedNpcs) {
            const npcB64 = await getRefBase64(npc, `npc_${npc.name}`);
            if (npcB64) { referenceImages.push(npcB64); refLabels.push('npc_ref'); }
        }
        if (matchedNpcs.length > 0) iigLog('INFO', `NPC refs matched: ${matchedNpcs.map(n => n.name).join(', ')}`);
        // 3b. Lorebook refs (auto-matched by trigger in prompt)
        const matchedLbRefs = getMatchedLorebookReferences(prompt);
        for (const lbRef of matchedLbRefs) {
            const lbPath = normalizeStoredImagePath(lbRef.imagePath);
            const lbB64 = await loadRefImageAsBase64(lbPath) || await imageUrlToBase64(lbPath);
            if (lbB64) { referenceImages.push(lbB64); refLabels.push('lorebook_ref'); }
        }
        if (matchedLbRefs.length > 0) iigLog('INFO', `Lorebook refs matched: ${matchedLbRefs.map(r => r.name).join(', ')}`);
        // 4. Wardrobe outfits — только те, что НЕ ушли аватар-референсом (примерки)
        if (botOutfit && !botOutfit.usedAsAvatar) { referenceImages.push(botOutfit.b64); refLabels.push('char_outfit'); }
        if (userOutfit && !userOutfit.usedAsAvatar) { referenceImages.push(userOutfit.b64); refLabels.push('user_outfit'); }
        if (botOutfit || userOutfit) iigLog('INFO', `Wardrobe refs: bot=${botOutfit ? (botOutfit.usedAsAvatar ? 'try-on→avatar' : 'outfit') : 'none'}, user=${userOutfit ? (userOutfit.usedAsAvatar ? 'try-on→avatar' : 'outfit') : 'none'}`);
        // 5. Context (previous generated images — LOWEST priority)
        if (settings.imageContextEnabled) {
            const contextCount = normalizeImageContextCount(settings.imageContextCount);
            const contextRefs = await collectPreviousContextReferences(options.messageId, 'base64', contextCount);
            for (const cr of contextRefs) { referenceImages.push(cr); refLabels.push('context'); }
        }
    }

    // Naistera references: data URLs
    if (settings.apiType === 'naistera') {
        // Активные образы гардероба — заранее: образ-примерка подменяет собой аватар-референс.
        const botOutfit = await getWardrobeOutfitRef('bot');
        const userOutfit = await getWardrobeOutfitRef('user');
        // Character/User reference — ТОЛЬКО если включено (примерка → ручной ref → Avatar Library → ST)
        if (settings.sendCharAvatar) {
            if (botOutfit?.tryOn) {
                referenceDataUrls.push(`data:image/png;base64,${botOutfit.b64}`); botOutfit.usedAsAvatar = true;
            } else {
                const charUrl = await getRefDataUrl(refs.charRef);
                if (charUrl) {
                    referenceDataUrls.push(charUrl);
                } else {
                    const charAvatarB64 = await getCharacterAvatarBase64();
                    if (charAvatarB64) referenceDataUrls.push(`data:image/png;base64,${charAvatarB64}`);
                }
            }
        }
        if (settings.sendUserAvatar) {
            if (userOutfit?.tryOn) {
                referenceDataUrls.push(`data:image/png;base64,${userOutfit.b64}`); userOutfit.usedAsAvatar = true;
            } else {
                const userUrl = await getRefDataUrl(refs.userRef);
                if (userUrl) {
                    referenceDataUrls.push(userUrl);
                } else {
                    const userAvatarB64 = await getUserAvatarBase64();
                    if (userAvatarB64) referenceDataUrls.push(`data:image/png;base64,${userAvatarB64}`);
                }
            }
        }
        const matchedNpcs = matchNpcReferences(prompt, refs.npcReferences);
        for (const npc of matchedNpcs) {
            const npcUrl = await getRefDataUrl(npc);
            if (npcUrl) referenceDataUrls.push(npcUrl);
        }
        // Lorebook refs (Naistera uses data URLs)
        const matchedLbRefsNaistera = getMatchedLorebookReferences(prompt);
        for (const lbRef of matchedLbRefsNaistera) {
            const lbPath = normalizeStoredImagePath(lbRef.imagePath);
            const lbB64 = await loadRefImageAsBase64(lbPath) || await imageUrlToBase64(lbPath);
            if (lbB64) referenceDataUrls.push(`data:image/png;base64,${lbB64}`);
        }
        if (matchedLbRefsNaistera.length > 0) iigLog('INFO', `Lorebook refs matched (naistera): ${matchedLbRefsNaistera.map(r => r.name).join(', ')}`);
        if (settings.imageContextEnabled) {
            const contextCount = normalizeImageContextCount(settings.imageContextCount);
            const contextRefs = await collectPreviousContextReferences(options.messageId, 'dataUrl', contextCount);
            referenceDataUrls.push(...contextRefs);
        }
        // Wardrobe outfits — только те, что НЕ ушли аватар-референсом (примерки)
        if (botOutfit && !botOutfit.usedAsAvatar) referenceDataUrls.push(`data:image/png;base64,${botOutfit.b64}`);
        if (userOutfit && !userOutfit.usedAsAvatar) referenceDataUrls.push(`data:image/png;base64,${userOutfit.b64}`);
    }

    // OpenAI / Void / Custom (non-gemini, non-naistera): collect references
    if (!usesGeminiRoute(settings) && settings.apiType !== 'naistera') {
        // Активные образы гардероба — заранее: образ-примерка подменяет собой аватар-референс.
        const botOutfit = await getWardrobeOutfitRef('bot');
        const userOutfit = await getWardrobeOutfitRef('user');
        // 1. Character reference (примерка образа → ручной charRef → Avatar Library → ST аватар) — ТОЛЬКО если включено
        if (settings.sendCharAvatar) {
            if (botOutfit?.tryOn) {
                referenceImages.push(botOutfit.b64); refLabels.push('char_ref'); botOutfit.usedAsAvatar = true;
            } else {
                const charB64 = await getRefBase64(refs.charRef, 'charRef') || await getCharacterAvatarBase64();
                if (charB64) { referenceImages.push(charB64); refLabels.push('char_ref'); }
            }
        }
        // 2. User reference (примерка образа → ручной userRef → Avatar Library → ST персона) — ТОЛЬКО если включено
        if (settings.sendUserAvatar) {
            if (userOutfit?.tryOn) {
                referenceImages.push(userOutfit.b64); refLabels.push('user_ref'); userOutfit.usedAsAvatar = true;
            } else {
                const userB64 = await getRefBase64(refs.userRef, 'userRef') || await getUserAvatarBase64();
                if (userB64) { referenceImages.push(userB64); refLabels.push('user_ref'); }
            }
        }
        // 3. NPC references (auto-matched by name in prompt)
        const matchedNpcs = matchNpcReferences(prompt, refs.npcReferences);
        for (const npc of matchedNpcs) {
            const npcB64 = await getRefBase64(npc, `npc_${npc.name}`);
            if (npcB64) { referenceImages.push(npcB64); refLabels.push('npc_ref'); }
        }
        if (matchedNpcs.length > 0) iigLog('INFO', `NPC refs matched: ${matchedNpcs.map(n => n.name).join(', ')}`);
        // 3b. Lorebook refs (auto-matched by trigger in prompt)
        const matchedLbRefsOai = getMatchedLorebookReferences(prompt);
        for (const lbRef of matchedLbRefsOai) {
            const lbPath = normalizeStoredImagePath(lbRef.imagePath);
            const lbB64 = await loadRefImageAsBase64(lbPath) || await imageUrlToBase64(lbPath);
            if (lbB64) { referenceImages.push(lbB64); refLabels.push('lorebook_ref'); }
        }
        if (matchedLbRefsOai.length > 0) iigLog('INFO', `Lorebook refs matched: ${matchedLbRefsOai.map(r => r.name).join(', ')}`);
        // 4. Wardrobe outfits — только те, что НЕ ушли аватар-референсом (примерки)
        if (botOutfit && !botOutfit.usedAsAvatar) { referenceImages.push(botOutfit.b64); refLabels.push('char_outfit'); }
        if (userOutfit && !userOutfit.usedAsAvatar) { referenceImages.push(userOutfit.b64); refLabels.push('user_outfit'); }
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

    // Промпт до инъекций внешности — на нём матчились картинки-референсы выше;
    // на нём же матчим описания лорбук-референсов, чтобы наборы картинок и описаний
    // совпадали (как в оригинале 2.0-beta).
    const userPromptForRefs = prompt;

    // ── Inject appearance descriptions into prompt ──
    {
        const ctx = SillyTavern.getContext();
        const charName = (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]?.name) || 'Character';
        const userName = ctx.name1 || 'User';

        // Внешность аватаров — по своему флагу. Активный аватар библиотеки даёт свой текст;
        // если аватар из библиотеки НЕ выбран (работает ориг. аватар ST) — фолбэк на
        // per-char/per-persona описание (charDescByKey/userDescByKey). Без кросс-фолбэка:
        // при активном аватаре описание ориг. авы не подмешиваем — это другое лицо.
        if (settings.injectAvatarAppearanceToGeneration) {
            const parts = [];
            const charItem = getActiveAvatarItem('char');
            const charApp = charItem ? String(charItem.appearance || '').trim() : getCharDescription().trim();
            if (charApp) parts.push(`[${charName} looks like: ${charApp}]`);
            const userItem = getActiveAvatarItem('user');
            const userApp = userItem ? String(userItem.appearance || '').trim() : getUserDescription().trim();
            if (userApp) parts.push(`[${userName} looks like: ${userApp}]`);
            if (parts.length > 0) {
                prompt = `${parts.join(' ')}\n${prompt}`;
                iigLog('INFO', `Avatar appearance injected: ${parts.length}`);
            }
        }

        // NPC внешность — по совпадению имени/алиасов в промпте.
        if (settings.injectDescriptions !== false) {
            const matchedNpcsForDesc = matchNpcReferences(prompt, refs.npcReferences);
            const npcDescParts = matchedNpcsForDesc
                .filter(n => String(n.description || '').trim())
                .map(n => `[NPC Reference: ${n.name}'s appearance: ${n.description.trim()}]`);
            if (npcDescParts.length > 0) {
                prompt = `${npcDescParts.join(' ')}\n${prompt}`;
                iigLog('INFO', `NPC descriptions injected: ${npcDescParts.map(p => p.slice(0, 40)).join(', ')}`);
            }
        }
    }

    // ── Inject wardrobe outfit descriptions into prompt ──
    if (window.sillyWardrobe?.isReady()) {
        const botData = window.sillyWardrobe.getActiveOutfitData('bot');
        const userData = window.sillyWardrobe.getActiveOutfitData('user');
        const cleanWardrobeDesc = (raw) => String(raw || '')
            .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
            .replace(/<\/?think\b[^>]*>/gi, '')
            .replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '')
            .replace(/\[(?:thinking|thought|reasoning)\][\s\S]*?\[\/(?:thinking|thought|reasoning)\]/gi, '')
            .replace(/\s+/g, ' ').trim();
        const parts = [];
        const botDesc = cleanWardrobeDesc(botData?.description);
        const userDesc = cleanWardrobeDesc(userData?.description);
        if (botDesc) parts.push(`[Character's current outfit: ${botDesc}]`);
        if (userDesc) parts.push(`[User's current outfit: ${userDesc}]`);
        if (parts.length > 0) {
            prompt = `${parts.join(' ')}\n${prompt}`;
            iigLog('INFO', `Wardrobe descriptions injected: ${parts.join(', ')}`);
        }
    }

    // ── Inject lorebook ref descriptions into prompt (gated by sendRefDescriptions) ──
    if (settings.sendRefDescriptions !== false) {
        const allMatched = getMatchedLorebookReferences(userPromptForRefs);
        const descItems = allMatched
            .map(ref => {
                const name = String(ref?.name || '').trim();
                const desc = String(ref?.description || '').trim();
                if (name && desc) return `${name}: ${desc}`;
                return desc || name;
            })
            .filter(Boolean);
        if (descItems.length > 0) {
            const block = `Reference descriptions (use these to keep characters and items visually consistent):\n${descItems.map(d => `- ${d}`).join('\n')}`;
            prompt = `${prompt}\n\n${block}`;
            iigLog('INFO', `Lorebook descriptions injected: ${descItems.length} items`);
        }
    }

    // ── Save debug snapshot ──
    {
        const previewRefs = [];
        for (let ri = 0; ri < refLabels.length; ri++) {
            let rawB64 = '';
            if (ri < referenceImages.length && referenceImages[ri]) rawB64 = referenceImages[ri];
            else if (ri < referenceDataUrls.length && referenceDataUrls[ri]) rawB64 = referenceDataUrls[ri].replace(/^data:[^;]+;base64,/, '');
            if (rawB64) previewRefs.push({ label: refLabels[ri], _b64: rawB64 });
        }
        for (const pr of previewRefs) {
            try { pr.dataUrl = `data:image/jpeg;base64,${await compressBase64Image(pr._b64, 96, 0.5)}`; }
            catch { pr.dataUrl = `data:image/png;base64,${pr._b64}`; }
            delete pr._b64;
        }
        _lastGenDebug = {
            timestamp: new Date().toISOString(),
            apiType: settings.apiType,
            model: settings.apiType === 'naistera' ? normalizeNaisteraModel(options.model || settings.naisteraModel) : settings.model,
            size: settings.size || '(auto)',
            style: style || '(none)',
            refCount: refLabels.length,
            refLabels: [...refLabels],
            previewRefs,
            matchedNpcs: matchNpcReferences(userPromptForRefs, refs.npcReferences).map(n => n.name),
            matchedLorebook: getMatchedLorebookReferences(userPromptForRefs).map(r => r.name),
            prompt,
        };
    }

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (options.signal?.aborted) {
                throw options.signal.reason || new DOMException('Генерация отменена пользователем', 'AbortError');
            }
            onStatusUpdate?.(`Генерация${attempt > 0 ? ` (повтор ${attempt}/${maxRetries})` : ''}...`);
            let generated;
            // Choose API based on type or model
            if (settings.apiType === 'custom') {
                const fmt = settings.customRequestFormat || 'openai';
                const overrideUrl = (settings.customFullUrl || '').trim() || null;
                const customOpts = { ...options, overrideUrl };
                if (fmt === 'naistera') {
                    generated = await generateImageNaistera(prompt, style, {
                        ...customOpts,
                        referenceImages: referenceDataUrls,
                        videoTestMode: enableVideoTest,
                        videoEveryN: settings.naisteraVideoEveryN,
                    });
                } else if (fmt === 'void') {
                    generated = await generateImageVoid(prompt, style, referenceImages, { ...customOpts, refLabels });
                } else if (fmt === 'gemini') {
                    generated = await generateImageGemini(prompt, style, referenceImages, { ...customOpts, refLabels });
                } else if (fmt === 'electronhub') {
                    generated = await generateImageElectronHub(prompt, style, referenceImages, customOpts);
                } else {
                    generated = await generateImageOpenAI(prompt, style, referenceImages, { ...customOpts, refLabels });
                }
            } else if (settings.apiType === 'naistera') {
                generated = await generateImageNaistera(prompt, style, {
                    ...options,
                    referenceImages: referenceDataUrls,
                    videoTestMode: enableVideoTest,
                    videoEveryN: settings.naisteraVideoEveryN,
                });
            } else if (settings.apiType === 'electronhub') {
                generated = await generateImageElectronHub(prompt, style, referenceImages, { ...options, refLabels });
            } else if (settings.apiType === 'void') {
                generated = await generateImageVoid(prompt, style, referenceImages, { ...options, refLabels });
            } else if (usesGeminiRoute(settings)) {
                generated = await generateImageGemini(prompt, style, referenceImages, { ...options, refLabels });
            } else {
                generated = await generateImageOpenAI(prompt, style, referenceImages, { ...options, refLabels });
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
            console.error(`[IIG] Generation attempt ${attempt + 1} failed:`, error?.message || error);

            // Отмена пользователем — не ретраим, пробрасываем сразу.
            if (isGenerationCancelled(error, options.signal)) {
                throw options.signal?.reason || error;
            }

            // Check if retryable. 503 "No providers available" is permanent for the model — don't retry.
            const msg = error.message || '';
            const noProviders = /no providers available/i.test(msg);
            const isRetryable = !noProviders && (
                msg.includes('429') ||
                msg.includes('502') ||
                msg.includes('504') ||
                msg.includes('timeout') ||
                msg.includes('network')
            );

            if (!isRetryable || attempt === maxRetries) {
                break;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            onStatusUpdate?.(`Повтор через ${delay / 1000}с...`);
            // Пауза перед повтором прерывается кнопкой «Остановить».
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, delay);
                options.signal?.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(options.signal.reason || new DOMException('Генерация отменена пользователем', 'AbortError'));
                }, { once: true });
            });
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
        const hasExternalUrl = srcValue && /^https?:\/\//i.test(srcValue); // LLM hallucinated an external URL
        
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
        } else if (hasExternalUrl) {
            // LLM hallucinated an external URL (pollinations.ai, etc.) — treat as needing generation
            iigLog('WARN', `External URL in src (LLM hallucination): ${srcValue.substring(0, 80)}`);
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
    const abortController = new AbortController();
    placeholder.className = 'iig-loading-placeholder';
    placeholder.dataset.tagId = tagId;
    placeholder._abortController = abortController;
    placeholder.innerHTML = `
        <div class="iig-spinner"></div>
        <div class="iig-status">Генерация картинки...</div>
        <div class="iig-timer">0s</div>
        <button type="button" class="iig-cancel-generation" title="Отменить генерацию"><i class="fa-solid fa-circle-stop"></i><span>Остановить</span></button>
    `;

    const cancelButton = placeholder.querySelector('.iig-cancel-generation');
    cancelButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (abortController.signal.aborted) return;
        cancelButton.disabled = true;
        placeholder.classList.add('iig-generation-cancelling');
        const statusEl = placeholder.querySelector('.iig-status');
        if (statusEl) statusEl.textContent = 'Отмена...';
        abortController.abort(new DOMException('Генерация отменена пользователем', 'AbortError'));
    });

    const timerEl = placeholder.querySelector('.iig-timer');
    const start = Date.now();
    const iv = setInterval(() => {
        if (!placeholder.isConnected) { clearInterval(iv); return; }
        const sec = Math.floor((Date.now() - start) / 1000);
        timerEl.textContent = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
    }, 1000);
    placeholder._timerInterval = iv;
    return placeholder;
}

// Сигнал отмены лоадера (кнопка «Остановить»).
function getLoadingSignal(placeholder) {
    return placeholder?._abortController?.signal || null;
}

// Вызвать при успешном завершении: если юзер успел нажать отмену — бросаем AbortError,
// иначе гасим кнопку (генерация уже закончилась, отменять нечего).
function finishLoadingGeneration(placeholder) {
    const signal = getLoadingSignal(placeholder);
    if (signal?.aborted) throw signal.reason || new DOMException('Генерация отменена пользователем', 'AbortError');
    const cancelButton = placeholder?.querySelector('.iig-cancel-generation');
    if (cancelButton) cancelButton.disabled = true;
}

function isGenerationCancelled(error, signal = null) {
    return !!signal?.aborted || error?.name === 'AbortError';
}

function clearLoadingPlaceholderTimer(placeholder) {
    if (placeholder?._timerInterval) {
        clearInterval(placeholder._timerInterval);
        placeholder._timerInterval = null;
    }
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
        processingMessages.delete(messageId);
        return;
    }

    const mesTextEl = messageElement.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(messageId);
        return;
    }
    
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
                resolveEffectiveStyle(tag.style),
                (status) => { statusEl.textContent = status; },
                { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId, signal: getLoadingSignal(loadingPlaceholder) }
            );
            finishLoadingGeneration(loadingPlaceholder);
            clearLoadingPlaceholderTimer(loadingPlaceholder);

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
            clearLoadingPlaceholderTimer(loadingPlaceholder);
            const cancelled = isGenerationCancelled(error, getLoadingSignal(loadingPlaceholder));
            iigLog(cancelled ? 'INFO' : 'ERROR', `${cancelled ? 'Cancelled' : 'Failed to generate'} image for tag ${index}:`, error.message);

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

            if (cancelled) toastr.info('Генерация отменена', 'Генерация картинок', { timeOut: 2500 });
            else toastr.error(`Ошибка генерации: ${error.message}`, 'Генерация картинок');
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
    if (message.extra?.iig_history_pic) {
        // Иллюстрация сцены: наш markup — мимо messageFormatting, иначе юзерские
        // анти-HTML регексы зачищают сообщение в ноль (см. historyPicRenderHtml).
        mesTextEl.innerHTML = historyPicRenderHtml(message);
        console.log('[IIG] History-pic message re-rendered directly');
    } else if (typeof context.messageFormatting === 'function') {
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
 * Перерисовать сообщение из источника (message.mes/display_text) и заново навесить
 * кнопки на картинки. Лечит «протухший» DOM: вечные спиннеры от упавших генераций,
 * потерянные обёртки с кнопками и т.п.
 */
// «Иллюстрация сцены» — сообщение с нашим СОБСТВЕННЫМ разметкой (цитата + картинка).
// Его нельзя пропускать через messageFormatting: юзерские regex-скрипты (анти-HTML
// «вэнквишеры») вычищают его в ноль, а у скрытых (is_system) сообщений ST не считает
// depth (исключает их из usableMessages) — из-за этого minDepth-ограничения регексов
// не срабатывают, и даже свежее сообщение попадает под нож. Рендерим сами.
function historyPicRenderHtml(message) {
    const raw = String(message?.mes || '');
    try {
        if (window.DOMPurify?.sanitize) return window.DOMPurify.sanitize(raw);
    } catch (_) { /* нет DOMPurify — mes целиком наш, отдаём как есть */ }
    return raw;
}

// Идемпотентное восстановление DOM такого сообщения (загрузка чата, редактирование,
// любые перерисовки ST). true = содержимое вписали заново.
function restoreHistoryPicMessageDom(messageId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    if (!message?.extra?.iig_history_pic) return false;
    const mesTextEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if (!mesTextEl) return false;
    // Картинка/видео уже на месте (сырым тегом или обёрнутым конвейером) — не трогаем.
    if (mesTextEl.querySelector('img, video')) return false;
    mesTextEl.innerHTML = historyPicRenderHtml(message);
    return true;
}

function rerenderMessageFromSource(messageId) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const message = context.chat[messageId];
    const mesTextEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if (!message || !mesTextEl) return null;
    if (message.extra?.iig_history_pic) {
        // Наш собственный markup — мимо messageFormatting (см. historyPicRenderHtml).
        mesTextEl.innerHTML = historyPicRenderHtml(message);
    } else if (typeof context.messageFormatting === 'function') {
        mesTextEl.innerHTML = context.messageFormatting(
            getMessageRenderText(message, settings),
            message.name,
            message.is_system,
            message.is_user,
            messageId
        );
    }
    enhanceRenderedImages(mesTextEl, messageId);
    return mesTextEl;
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
    const mesTextEl = messageElement?.querySelector('.mes_text');
    if (!mesTextEl) {
        processingMessages.delete(messageId);
        toastr.error('Элемент сообщения не найден', 'Генерация картинок');
        return;
    }

    try {
        for (let index = 0; index < tags.length; index++) {
            const tag = tags[index];
            const tagId = `iig-regen-${messageId}-${index}`;
            const taskKey = singleTagTaskKey(messageId, index);
            if (activeSingleTagTasks.has(taskKey)) {
                iigLog('INFO', `Skipping tag ${index}: already being generated`);
                continue;
            }
            activeSingleTagTasks.add(taskKey);
            let loadingPlaceholder = null;
            let replacedEl = null;

            try {
                // Find the existing rendered media element with data-iig-instruction
                let existingMediaList = Array.from(
                    mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]')
                );
                let existingMedia = existingMediaList.find((m) => Number.parseInt(m.dataset.iigTagIndex || '', 10) === index)
                    || existingMediaList[index]
                    || null;
                if (!existingMedia) {
                    // DOM протух (вечный спиннер от упавшей попытки и т.п.) — восстановим разметку из источника
                    rerenderMessageFromSource(messageId);
                    existingMediaList = Array.from(
                        mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]')
                    );
                    existingMedia = existingMediaList[index] || null;
                }
                if (!existingMedia) {
                    throw new Error(`Картинка ${index + 1} не найдена в сообщении`);
                }

                // Preserve the instruction for future regenerations
                const instruction = existingMedia.getAttribute('data-iig-instruction');

                // Если картинка обёрнута панелькой действий — заменяем всю обёртку
                replacedEl = existingMedia.closest('.iig-image-wrapper') || existingMedia;
                loadingPlaceholder = createLoadingPlaceholder(tagId);
                replacedEl.replaceWith(loadingPlaceholder);

                const statusEl = loadingPlaceholder.querySelector('.iig-status');

                const generated = await generateImageWithRetry(
                    tag.prompt,
                    resolveEffectiveStyle(tag.style),
                    (status) => { statusEl.textContent = status; },
                    { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId, signal: getLoadingSignal(loadingPlaceholder) }
                );
                finishLoadingGeneration(loadingPlaceholder);
                clearLoadingPlaceholderTimer(loadingPlaceholder);

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
                mediaElement.dataset.iigTagIndex = String(index);

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
            } catch (error) {
                clearLoadingPlaceholderTimer(loadingPlaceholder);
                const cancelled = isGenerationCancelled(error, getLoadingSignal(loadingPlaceholder));
                // Возвращаем старую картинку на место вместо вечного спиннера —
                // кнопки действий сохраняются, можно повторить попытку.
                if (loadingPlaceholder?.isConnected && replacedEl) {
                    loadingPlaceholder.replaceWith(replacedEl);
                }
                iigLog(cancelled ? 'INFO' : 'ERROR', `Regeneration ${cancelled ? 'cancelled' : 'failed'} for tag ${index}:`, error.message);
                if (cancelled) {
                    toastr.info('Генерация отменена', 'Генерация картинок', { timeOut: 2500 });
                    break;
                }
                toastr.error(`Ошибка: ${error.message}`, 'Генерация картинок');
            } finally {
                activeSingleTagTasks.delete(taskKey);
            }
        }
    } finally {
        processingMessages.delete(messageId);
        await context.saveChat();
        iigLog('INFO', `Regeneration complete for message ${messageId}`);
    }
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
            // Иллюстрацию сцены могли вычистить регексы при отрисовке — возвращаем.
            try { restoreHistoryPicMessageDom(messageId); } catch (_) {}
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

    // Иллюстрация сцены: ST мог отрисовать её пустой (регексы юзера) — возвращаем разметку.
    try { restoreHistoryPicMessageDom(messageId); } catch (_) {}

    await processMessageTags(messageId);
    
    // Enhance already-rendered images with zoom/fullscreen/regen buttons
    // Called AFTER processMessageTags to survive the messageFormatting re-render
    const mesTextElForEnhance = messageElement.querySelector('.mes_text');
    if (mesTextElForEnhance) {
        enhanceRenderedImages(mesTextElForEnhance, messageId);
    }
}

// ── Vision model keywords for wardrobe auto-select ──
const VISION_MODEL_KEYWORDS = [
    'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-4.1', 'gpt-4.5',
    'gemini', 'claude', 'llava', 'cogvlm', 'qwen-vl', 'qwen2-vl', 'internvl',
    'pixtral', 'moondream', 'deepseek-vl', 'yi-vision',
];

function isVisionModel(modelId) {
    const mid = modelId.toLowerCase();
    // Exclude pure image generation models
    for (const kw of IMAGE_MODEL_KEYWORDS) {
        if (mid.includes(kw)) return false;
    }
    return VISION_MODEL_KEYWORDS.some(kw => mid.includes(kw)) || mid.includes('vision');
}

/**
 * Render lorebook selector and ref cards.
 */
function renderLorebookUI() {
    const settings = getSettings();
    const lorebooks = ensureLorebooks(settings);
    const active = getActiveLorebook(settings);

    // Populate lorebook selector
    const select = document.getElementById('iig_lorebook_select');
    if (select) {
        select.innerHTML = lorebooks.map(lb =>
            `<option value="${sanitizeForHtml(lb.id)}" ${lb.id === settings.activeLorebookId ? 'selected' : ''}>${sanitizeForHtml(lb.name)}${lb.enabled ? '' : ' (выкл)'}</option>`
        ).join('');
    }

    // Active-lorebook enabled checkbox
    const enabledCb = document.getElementById('iig_lorebook_enabled');
    if (enabledCb) enabledCb.checked = active ? active.enabled !== false : false;

    // Send-descriptions checkbox
    const sendDescCb = document.getElementById('iig_lorebook_send_descriptions');
    if (sendDescCb) sendDescCb.checked = settings.sendRefDescriptions !== false;

    // Render ref cards
    const container = document.getElementById('iig_lorebook_refs_list');
    if (!container || !active) return;

    if (active.refs.length === 0) {
        container.innerHTML = '<p class="hint">Пусто. Добавьте референс с именем-триггером и картинкой.</p>';
        updateLorebookStatus();
        return;
    }

    const lastIndex = active.refs.length - 1;
    container.innerHTML = active.refs.map((ref, index) => {
        const previewSrc = normalizeStoredImagePath(ref.imagePath);
        const isAlways = ref.matchMode === 'always';
        const isEnabled = ref.enabled !== false;
        const useRegex = ref.useRegex === true;
        const previewHtml = previewSrc
            ? `<img src="${sanitizeForHtml(previewSrc)}" alt="${sanitizeForHtml(ref.name || `ref-${index + 1}`)}" class="iig-lb-ref-thumb">`
            : `<div class="iig-lb-ref-thumb iig-lb-ref-thumb-placeholder"><i class="fa-solid fa-image" style="color:var(--SmartThemeQuoteColor);font-size:18px;"></i></div>`;
        return `
            <div class="iig-lb-ref-row ${isEnabled ? '' : 'iig-lb-ref-row-disabled'}" data-ref-index="${index}" data-ref-id="${sanitizeForHtml(ref.id)}">
                <div class="iig-lb-ref-content">
                    <div class="iig-lb-ref-preview">
                        ${previewHtml}
                        <label class="checkbox_label iig-lb-ref-enabled-toggle" title="${isEnabled ? 'Выключить' : 'Включить'}">
                            <input type="checkbox" class="iig-lb-ref-enabled" ${isEnabled ? 'checked' : ''}>
                            <span></span>
                        </label>
                    </div>
                    <div class="iig-lb-ref-main">
                        <div class="iig-lb-ref-header">
                            <input type="text" class="text_pole flex1 iig-lb-ref-name" placeholder="Имя-триггер (или regex)" value="${sanitizeForHtml(ref.name || '')}">
                            <label class="menu_button iig-lb-ref-upload" title="Загрузить изображение">
                                <i class="fa-solid fa-upload"></i>
                                <input type="file" accept="image/*" class="iig-lb-ref-file" style="display:none">
                            </label>
                            <div class="menu_button iig-lb-ref-upload-url" title="Загрузить по URL"><i class="fa-solid fa-link"></i></div>
                            <div class="menu_button iig-lb-ref-remove" title="Удалить" style="color:#cc5555;"><i class="fa-solid fa-trash"></i></div>
                        </div>
                        <textarea class="text_pole flex1 iig-lb-ref-description" rows="2" placeholder="Описание референса">${sanitizeForHtml(ref.description || '')}</textarea>
                        <div class="iig-lb-ref-grid">
                            <input type="text" class="text_pole iig-lb-ref-group" placeholder="Группа (characters, locations...)" value="${sanitizeForHtml(ref.group || '')}">
                            <input type="text" class="text_pole iig-lb-ref-secondary" placeholder="Вторичные ключи (AND, через запятую)" value="${sanitizeForHtml(ref.secondaryKeys || '')}">
                            <input type="number" class="text_pole iig-lb-ref-priority" placeholder="Приоритет" step="1" value="${Number.isFinite(ref.priority) ? ref.priority : 0}" title="Выше = приоритетнее при лимите референсов">
                        </div>
                        <div class="iig-lb-ref-footer">
                            <label class="checkbox_label">
                                <input type="checkbox" class="iig-lb-ref-always" ${isAlways ? 'checked' : ''}>
                                <span>${isAlways ? 'Всегда' : 'По совпадению'}</span>
                            </label>
                            <label class="checkbox_label" title="Интерпретировать триггер как JS regex (напр. /кот|котик/i)">
                                <input type="checkbox" class="iig-lb-ref-regex" ${useRegex ? 'checked' : ''}>
                                <span>Regex</span>
                            </label>
                            <div class="menu_button iig-lb-ref-vision ${previewSrc ? '' : 'iig-hidden'}" title="Сгенерировать описание через Vision AI"><i class="fa-solid fa-robot"></i></div>
                            <div class="iig-lb-ref-move">
                                <div class="menu_button iig-lb-ref-move-up ${index === 0 ? 'disabled' : ''}" title="Вверх"><i class="fa-solid fa-arrow-up"></i></div>
                                <div class="menu_button iig-lb-ref-move-down ${index === lastIndex ? 'disabled' : ''}" title="Вниз"><i class="fa-solid fa-arrow-down"></i></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    updateLorebookStatus();
}

function updateLorebookStatus() {
    const status = document.getElementById('iig_lorebook_status');
    if (!status) return;
    const allRefs = getAllEnabledLorebookReferences().filter(ref => ref.name && ref.imagePath);
    const enabledRefs = allRefs.filter(ref => ref.enabled !== false);
    const alwaysCount = enabledRefs.filter(ref => ref.matchMode === 'always').length;
    if (allRefs.length > 0) {
        status.textContent = `Активных референсов: ${enabledRefs.length}/${allRefs.length}. Всегда отправляются: ${alwaysCount}.`;
    } else {
        status.textContent = '';
    }
}

/**
 * Render reference image slots in the UI.
 */
function renderRefSlots() {
    const container = document.getElementById('iig_ref_slots');
    if (!container) return;
    const settings = getSettings();
    const refs = getCurrentCharacterRefs();

    const userAvatarDropdownHTML = `
        <div id="iig_user_avatar_manual_section" class="${!settings.sendUserAvatar ? 'iig-hidden' : ''}" style="margin-bottom:6px;">
            <h5 style="margin:0 0 4px;font-size:0.9em;"><i class="fa-solid fa-user"></i> Аватар {{user}} (из персоны ST)</h5>
            <div class="flex-row" style="gap:4px;align-items:center;">
                <div id="iig_user_avatar_dropdown" class="iig-avatar-dropdown">
                    <div id="iig_user_avatar_dropdown_selected" class="iig-avatar-dropdown-selected">
                        ${settings.userAvatarFile
                            ? `<img class="iig-dropdown-thumb" src="/User Avatars/${encodeURIComponent(settings.userAvatarFile)}" alt="" onerror="this.style.display='none'">
                               <span class="iig-dropdown-text" title="${settings.userAvatarFile}">${getPersonaDisplayName(settings.userAvatarFile)}</span>`
                            : `<div class="iig-dropdown-placeholder"><i class="fa-solid fa-user"></i></div>
                               <span class="iig-dropdown-text">-- Авто (из персоны) --</span>`}

                        <span class="iig-dropdown-arrow fa-solid fa-chevron-down"></span>
                    </div>
                    <div id="iig_user_avatar_dropdown_list" class="iig-avatar-dropdown-list"></div>
                </div>
                <div id="iig_user_avatar_refresh" class="menu_button iig-refresh-btn" title="Обновить список">
                    <i class="fa-solid fa-sync"></i>
                </div>
            </div>
        </div>`;

    // ── NPC slots (dynamic) ──
    const npcList = refs.npcReferences;
    let npcHTML = '';
    for (let i = 0; i < npcList.length; i++) {
        const npc = npcList[i] || { name: '', aliases: [], imageBase64: '', imagePath: '', description: '', enabled: true };
        const hasImg = !!(npc.imagePath || npc.imageBase64);
        const thumbSrc = npc.imageBase64 ? `data:image/jpeg;base64,${npc.imageBase64}` : normalizeStoredImagePath(npc.imagePath);
        const npcDescVal = (npc.description || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const npcAliasesVal = (Array.isArray(npc.aliases) ? npc.aliases.join(', ') : '').replace(/"/g, '&quot;');
        const npcEnabled = npc.enabled !== false;
        npcHTML += `
            <div class="iig-npc-card ${npcEnabled ? '' : 'iig-npc-card-disabled'}" data-slot-key="npc_${i}">
                <div class="iig-ref-slot" data-slot-key="npc_${i}">
                    <div class="iig-ref-slot-thumb" data-slot-key="npc_${i}" title="Загрузить изображение">
                        ${hasImg ? `<img src="${thumbSrc}" alt="NPC ${i+1}">` : `<i class="fa-solid fa-image" style="color:var(--SmartThemeQuoteColor);font-size:20px;"></i>`}
                    </div>
                    <div class="iig-ref-slot-info">
                        <label class="iig-ref-slot-label iig-npc-enabled-row" title="Включить/выключить NPC">
                            <input type="checkbox" class="iig-npc-enabled" data-npc-idx="${i}" ${npcEnabled ? 'checked' : ''}>
                            <span>NPC ${i + 1}</span>
                        </label>
                        <input type="text" class="text_pole iig-ref-name-input" data-slot-key="npc_${i}"
                               placeholder="Имя (триггер в промпте)" value="${(npc.name || '').replace(/"/g, '&quot;')}">
                        <input type="text" class="text_pole iig-npc-aliases" data-npc-idx="${i}"
                               placeholder="Алиасы через запятую" value="${npcAliasesVal}"
                               title="Доп. имена-триггеры, через запятую">
                    </div>
                    <div class="menu_button iig-npc-slot-remove" data-npc-idx="${i}" title="Удалить слот"><i class="fa-solid fa-trash-can"></i></div>
                </div>
                <div class="iig-npc-desc-row">
                    <textarea class="text_pole iig-npc-desc-input" data-npc-idx="${i}" rows="1"
                              placeholder="Описание внешности..."
                              style="font-size:0.82em;resize:vertical;min-height:28px;">${npcDescVal}</textarea>
                    <div class="menu_button iig-npc-desc-vision iig-lb-ref-vision" data-npc-idx="${i}" title="Описать через Vision AI"
                         style="padding:2px 6px;font-size:0.82em;${hasImg ? '' : 'opacity:0.3;pointer-events:none;'}">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                </div>
            </div>`;
    }
    npcHTML += `
        <div class="iig-npc-toolbar">
            <div id="iig_npc_add" class="menu_button" title="Добавить NPC"><i class="fa-solid fa-plus"></i> Добавить NPC</div>
            ${npcList.length > 0 ? `<div id="iig_npc_clear_all" class="menu_button" title="Очистить все" style="color:#cc5555;"><i class="fa-solid fa-trash-can"></i> Очистить все</div>` : ''}
        </div>`;

    container.innerHTML = `
        <!-- ── {{char}} ── -->
        <div style="margin-bottom:6px;">
            <label class="checkbox_label">
                <input type="checkbox" id="iig_send_char_avatar" ${settings.sendCharAvatar ? 'checked' : ''}>
                <span>Отправлять аватар {{char}}</span>
            </label>
        </div>
        <div style="margin-bottom:6px;">
            <label class="checkbox_label">
                <input type="checkbox" id="iig_inject_descriptions" ${settings.injectDescriptions !== false ? 'checked' : ''}>
                <span>Добавлять описания внешности в промпт</span>
            </label>
        </div>
        <div class="iig-avatar-appearance-controls" style="margin-bottom:8px;">
            <label class="checkbox_label" style="font-size:0.85em;">
                <input type="checkbox" id="iig_inject_avatar_appearance_gen" ${settings.injectAvatarAppearanceToGeneration ? 'checked' : ''}>
                <span>Внешность аватара → в промпт генерации</span>
            </label>
            <label class="checkbox_label" style="font-size:0.85em;">
                <input type="checkbox" id="iig_inject_avatar_appearance_chat" ${settings.injectAvatarAppearanceToChatEnabled ? 'checked' : ''}>
                <span>Внешность аватара → в контекст LLM</span>
            </label>
            <div style="font-size:0.78em;color:var(--SmartThemeQuoteColor);margin:2px 0 4px;">Берётся у активного аватара из библиотеки; если он не выбран — описание ориг. аватара ST (панель под сеткой).</div>
            <div class="flex-row" style="margin-top:2px;align-items:center;gap:6px;">
                <label for="iig_avatar_appearance_depth" style="font-size:0.8em;">Глубина инъекции</label>
                <input type="number" id="iig_avatar_appearance_depth" class="text_pole" style="width:64px;" value="${Number.isFinite(settings.avatarAppearanceInjectionDepth) ? settings.avatarAppearanceInjectionDepth : 1}" min="0" max="10">
            </div>
        </div>
        <div class="iig-avatar-lib-block" style="margin-bottom:10px;">
            <div style="font-size:0.85em;color:var(--SmartThemeQuoteColor);margin-bottom:4px;"><i class="fa-solid fa-images"></i> Аватары {{char}} — клик = сделать активным</div>
            <div id="iig_avatar_lib_char" class="iig-extras-grid"></div>
            <div id="iig_avatar_lib_char_hint" class="iig-avatar-lib-hint" style="display:none;font-size:0.8em;line-height:1.3;margin:4px 0 2px;padding:4px 6px;border-radius:4px;background:rgba(255,180,80,0.08);color:var(--SmartThemeQuoteColor);"></div>
            <div id="iig_avatar_desc_char"></div>
            <div class="iig-extras-add-row" style="display:flex;gap:4px;margin-top:4px;">
                <input type="text" id="iig_avatar_lib_char_name" class="text_pole flex1" placeholder="Имя аватара (необязательно)" style="font-size:0.82em;">
                <input type="file" id="iig_avatar_lib_char_file" accept="image/*" style="display:none">
                <div id="iig_avatar_lib_char_add" class="menu_button" title="Добавить аватар"><i class="fa-solid fa-plus"></i> Добавить</div>
            </div>
        </div>

        <hr style="margin:8px 0;opacity:0.15;">

        <!-- ── {{user}} ── -->
        <div style="margin-bottom:6px;">
            <label class="checkbox_label">
                <input type="checkbox" id="iig_send_user_avatar" ${settings.sendUserAvatar ? 'checked' : ''}>
                <span>Отправлять аватар {{user}}</span>
            </label>
        </div>
        ${userAvatarDropdownHTML}
        <div class="iig-avatar-lib-block" style="margin-bottom:6px;">
            <div style="font-size:0.85em;color:var(--SmartThemeQuoteColor);margin-bottom:4px;"><i class="fa-solid fa-images"></i> Аватары {{user}} — клик = сделать активным</div>
            <div id="iig_avatar_lib_user" class="iig-extras-grid"></div>
            <div id="iig_avatar_lib_user_hint" class="iig-avatar-lib-hint" style="display:none;font-size:0.8em;line-height:1.3;margin:4px 0 2px;padding:4px 6px;border-radius:4px;background:rgba(255,180,80,0.08);color:var(--SmartThemeQuoteColor);"></div>
            <div id="iig_avatar_desc_user"></div>
            <div class="iig-extras-add-row" style="display:flex;gap:4px;margin-top:4px;">
                <input type="text" id="iig_avatar_lib_user_name" class="text_pole flex1" placeholder="Имя аватара (необязательно)" style="font-size:0.82em;">
                <input type="file" id="iig_avatar_lib_user_file" accept="image/*" style="display:none">
                <div id="iig_avatar_lib_user_add" class="menu_button" title="Добавить аватар"><i class="fa-solid fa-plus"></i> Добавить</div>
            </div>
        </div>

        `;

    // ── NPC — replace container to discard stale event listeners ──
    const oldNpcContainer = document.getElementById('iig_npc_slots');
    if (oldNpcContainer) {
        const fresh = oldNpcContainer.cloneNode(false);
        fresh.innerHTML = npcHTML;
        oldNpcContainer.replaceWith(fresh);
    }

    // ── Avatar Library — наполняем сетки + панели внешности активных элементов ──
    renderAvatarGrid('char');
    renderAvatarGrid('user');
}

/* ── Avatar Library: рендер сетки аватаров (порт из megarakk) ── */
function renderAvatarGrid(target) {
    const containerId = target === 'user' ? 'iig_avatar_lib_user' : 'iig_avatar_lib_char';
    const container = document.getElementById(containerId);
    if (!container) return;
    const settings = getSettings();
    const items = ensureAvatarItems(settings).filter(a => a.target === target);
    const activeId = target === 'user' ? settings.activeAvatarUser : settings.activeAvatarChar;

    // Подсказка: активный аватар — это ГЛОБАЛЬНЫЙ пин; он перекрывает активную персону/
    // персонажа во всех генерациях (см. getUserAvatarBase64/getCharacterAvatarBase64).
    // Юзеры путаются: «регенерит одну персону, не активную» — это как раз закреплённый пин.
    const hintEl = document.getElementById(target === 'user' ? 'iig_avatar_lib_user_hint' : 'iig_avatar_lib_char_hint');
    if (hintEl) {
        const activeItem = activeId ? items.find(a => a.id === activeId) : null;
        if (activeItem) {
            const nm = sanitizeForHtml(activeItem.name || 'аватар');
            hintEl.innerHTML = target === 'user'
                ? `<i class="fa-solid fa-thumbtack"></i> Закреплён «${nm}» — он перекрывает активную персону ST во <b>всех</b> генерациях. Повторный клик по плитке снимает закрепление → фото пойдёт по активной персоне.`
                : `<i class="fa-solid fa-thumbtack"></i> Закреплён «${nm}» — он перекрывает дефолтный аватар персонажа. Повторный клик по плитке снимает закрепление.`;
            hintEl.style.display = '';
        } else {
            hintEl.innerHTML = '';
            hintEl.style.display = 'none';
        }
    }

    if (items.length === 0) {
        container.innerHTML = `<div class="iig-extras-empty">Пока нет аватаров. Добавьте, чтобы заменить дефолтный.</div>`;
        renderAvatarAppearancePanel(target);
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="iig-extras-card ${item.id === activeId ? 'iig-extras-active' : ''}" data-ava-id="${sanitizeForHtml(item.id)}" data-ava-target="${target}">
            <img src="data:image/png;base64,${item.imageData}" class="iig-extras-img" alt="${sanitizeForHtml(item.name)}">
            <div class="iig-extras-overlay">
                <span class="iig-extras-name" title="${sanitizeForHtml(item.name)}">${sanitizeForHtml(item.name)}</span>
                <i class="fa-solid fa-ellipsis iig-extras-more" data-ava-more="${sanitizeForHtml(item.id)}" title="Окошко аватара: имя, активация, удаление"></i>
            </div>
            ${item.id === activeId ? '<div class="iig-extras-check"><i class="fa-solid fa-check"></i></div>' : ''}
        </div>
    `).join('');

    container.querySelectorAll('.iig-extras-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target instanceof Element && e.target.closest('.iig-extras-more')) return;
            const avaId = card.getAttribute('data-ava-id');
            const avaTarget = card.getAttribute('data-ava-target') || target;
            if (!avaId) return;
            setActiveAvatar(avaId, avaTarget);
            renderAvatarGrid(avaTarget);
        });
    });
    // Удаление НЕ на плитке (случайные клики) — только внутри окошка аватара, с подтверждением.
    container.querySelectorAll('.iig-extras-more').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const avaId = btn.getAttribute('data-ava-more');
            if (avaId) openAvatarDialog(avaId, target);
        });
    });

    renderAvatarAppearancePanel(target);
}

/* ── Avatar Library: окошко аватара — превью, переименование, активация, удаление с подтверждением ── */
function openAvatarDialog(itemId, target) {
    document.getElementById('iig-ava-overlay')?.remove();
    const settings = getSettings();
    const item = ensureAvatarItems(settings).find(a => a.id === itemId);
    if (!item) return;
    const isActive = (target === 'user' ? settings.activeAvatarUser : settings.activeAvatarChar) === item.id;

    const ov = document.createElement('div');
    ov.id = 'iig-ava-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    // Окошко живёт в body, т.е. «вне» выдвижной панели расширений — гасим всплытие,
    // иначе ST считает клик кликом-наружу и закрывает панель настроек.
    for (const evt of ['mousedown', 'mouseup', 'click', 'touchstart', 'pointerdown']) {
        ov.addEventListener(evt, (e) => e.stopPropagation());
    }
    const panel = document.createElement('div');
    panel.id = 'iig-ava-dialog';
    panel.innerHTML = `
        <div class="iig-ava-head"><span></span><div class="iig-ava-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div></div>
        <div class="iig-ava-body">
            <img class="iig-ava-preview" src="data:image/png;base64,${item.imageData}" alt="avatar">
            <input type="text" class="text_pole iig-ava-name" maxlength="60" placeholder="Имя аватара">
            <div class="iig-ava-actions">
                <div class="menu_button iig-ava-activate">${isActive ? '<i class="fa-solid fa-toggle-on"></i> Активен — снять' : '<i class="fa-solid fa-toggle-off"></i> Сделать активным'}</div>
                <div class="menu_button iig-ava-delete"><i class="fa-solid fa-trash-can"></i> Удалить</div>
            </div>
        </div>`;
    ov.appendChild(panel); document.body.appendChild(ov);
    // Имя через .value/.textContent, не через innerHTML — кавычки в имени не ломают разметку.
    panel.querySelector('.iig-ava-head span').textContent = item.name;
    const nameInp = panel.querySelector('.iig-ava-name');
    nameInp.value = item.name;

    function escHandler(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }
    function close() { document.removeEventListener('keydown', escHandler, true); ov.remove(); }
    document.addEventListener('keydown', escHandler, true);
    panel.querySelector('.iig-ava-close').addEventListener('click', close);

    nameInp.addEventListener('input', () => {
        item.name = nameInp.value.trim() || 'Avatar';
        panel.querySelector('.iig-ava-head span').textContent = item.name;
        saveSettings();
        renderAvatarGrid(target);
    });

    panel.querySelector('.iig-ava-activate').addEventListener('click', () => {
        setActiveAvatar(item.id, target);
        renderAvatarGrid(target);
        close();
    });

    // Двухшаговое удаление: первый клик — «Точно удалить?», второй — удаляет.
    const delBtn = panel.querySelector('.iig-ava-delete');
    delBtn.addEventListener('click', () => {
        if (!delBtn.classList.contains('iig-ava-del-confirm')) {
            delBtn.classList.add('iig-ava-del-confirm');
            delBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Точно удалить?';
            return;
        }
        removeAvatarItem(item.id);
        renderAvatarGrid(target);
        close();
        toastr.info(`Аватар «${item.name}» удалён`, 'Генерация картинок', { timeOut: 2000 });
    });
}

/* ── Avatar Library: панель описания внешности активного аватара ── */
function renderAvatarAppearancePanel(target) {
    const panelId = target === 'user' ? 'iig_avatar_desc_user' : 'iig_avatar_desc_char';
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const activeItem = getActiveAvatarItem(target);
    // Аватар из библиотеки не выбран → работает ОРИГИНАЛЬНЫЙ аватар ST — даём панель для него.
    if (!activeItem) { renderOrigAvatarAppearancePanel(panel, target); return; }

    panel.innerHTML = `
        <div class="iig-avatar-desc-panel">
            <div class="iig-avatar-desc-head"><i class="fa-solid fa-user"></i> Внешность: <b>${sanitizeForHtml(activeItem.name)}</b></div>
            <textarea class="text_pole iig-avatar-desc-textarea" rows="3"
                placeholder="Опишите внешность вручную или нажмите «ИИ» для авто-описания..."
                data-ava-id="${sanitizeForHtml(activeItem.id)}">${sanitizeForHtml(activeItem.appearance || '')}</textarea>
            <div class="iig-avatar-desc-actions" style="display:flex;gap:4px;margin-top:4px;">
                <div class="menu_button iig-avatar-desc-generate" data-ava-id="${sanitizeForHtml(activeItem.id)}" title="Сгенерировать через Vision AI"><i class="fa-solid fa-robot"></i> ИИ</div>
                <div class="menu_button iig-avatar-desc-clear" data-ava-id="${sanitizeForHtml(activeItem.id)}" title="Очистить"><i class="fa-solid fa-eraser"></i></div>
                <div class="menu_button iig-avatar-desc-delete" style="margin-left:auto;" title="Удалить этот аватар из библиотеки"><i class="fa-solid fa-trash-can"></i></div>
            </div>
        </div>
    `;

    // Удаление активного аватара — двухшаговое подтверждение (защита от случайного клика).
    const delBtn = panel.querySelector('.iig-avatar-desc-delete');
    delBtn?.addEventListener('click', () => {
        if (!delBtn.classList.contains('iig-ava-del-confirm')) {
            delBtn.classList.add('iig-ava-del-confirm');
            delBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Точно?';
            return;
        }
        removeAvatarItem(activeItem.id);
        renderAvatarGrid(target);
        toastr.info(`Аватар «${activeItem.name}» удалён`, 'Генерация картинок', { timeOut: 2000 });
    });

    const textarea = panel.querySelector('.iig-avatar-desc-textarea');
    // Сохраняем и на input (мгновенно), и на blur — ввод не теряется.
    textarea?.addEventListener('input', () => updateAvatarItemAppearance(textarea.getAttribute('data-ava-id'), textarea.value));
    panel.querySelector('.iig-avatar-desc-clear')?.addEventListener('click', () => {
        if (!textarea) return;
        textarea.value = '';
        updateAvatarItemAppearance(textarea.getAttribute('data-ava-id'), '');
        toastr.info('Описание очищено', 'Генерация картинок', { timeOut: 1500 });
    });
    panel.querySelector('.iig-avatar-desc-generate')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const avaId = btn.getAttribute('data-ava-id');
        if (!avaId) return;
        btn.classList.add('disabled');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
        try {
            const description = await generateAvatarItemAppearance(avaId);
            if (textarea) textarea.value = description;
            toastr.success('Описание сгенерировано', 'Vision AI');
        } catch (err) {
            toastr.error(err.message || 'Ошибка Vision API', 'Vision AI');
        } finally {
            btn.classList.remove('disabled');
            btn.innerHTML = orig;
        }
    });
}

/* ── Внешность ОРИГИНАЛЬНОГО аватара (ST) — когда аватар из библиотеки не выбран ──
   Для старых ав, которые не хочется переносить в библиотеку. Описание НЕ одно на всех:
   {{char}} — у КАЖДОГО персонажа своё (charDescByKey по файлу карточки, редактируется
   для открытого перса); {{user}} — у КАЖДОЙ персоны своё (userDescByKey по аватару
   персоны, селектор позволяет заполнить любую, не переключаясь). При генерации и в
   контекст LLM уходит описание АКТИВНОЙ персоны / открытого перса — фолбэком вместо
   внешности активного аватара библиотеки. */
function renderOrigAvatarAppearancePanel(panel, target) {
    const ctx = SillyTavern.getContext();
    if (target === 'char' && !getCharKey()) { panel.innerHTML = ''; return; } // персонаж не открыт — не на ком закрепить
    const isUser = target === 'user';

    const personaLabel = (k) => {
        if (k === '__default_persona__') return 'Персона по умолчанию';
        const nm = getPersonaDisplayName(k) || k;
        return k === getPersonaKey() ? `${nm} (активная)` : nm;
    };
    const curKey = () => isUser ? iigCurrentUserDescKey() : getCharKey();
    const curName = () => isUser
        ? personaLabel(curKey())
        : (ctx.characters?.[ctx.characterId]?.name || 'персонаж');
    const getDesc = () => isUser ? getUserDescriptionFor(curKey()) : getCharDescription();
    const save = (v) => {
        if (isUser) setUserDescriptionFor(curKey(), v); else setCharDescription(v);
        updateAvatarAppearanceInjection(); // на генерации берётся активная персона / открытый перс
    };

    panel.innerHTML = `
        <div class="iig-avatar-desc-panel">
            <div class="iig-avatar-desc-head"><i class="fa-solid fa-id-badge"></i> Внешность (ориг. аватар): <b></b></div>
            ${isUser ? '<select class="text_pole iig-avatar-desc-persona" title="Чьё описание редактируем — у каждой персоны своё. На генерации используется активная."></select>' : ''}
            <textarea class="text_pole iig-avatar-desc-textarea" rows="3"
                placeholder="${isUser
                    ? 'Описание внешности для ориг. аватарки выбранной персоны (у каждой — своё). Вручную или кнопкой «ИИ»...'
                    : 'Описание внешности для ориг. аватарки этого персонажа (у каждого — своё). Вручную или кнопкой «ИИ»...'}"></textarea>
            <div class="iig-avatar-desc-actions" style="display:flex;gap:4px;margin-top:4px;">
                <div class="menu_button iig-avatar-desc-generate" title="Описать ориг. аватар через Vision AI"><i class="fa-solid fa-robot"></i> ИИ</div>
                <div class="menu_button iig-avatar-desc-clear" title="Очистить"><i class="fa-solid fa-eraser"></i></div>
            </div>
        </div>
    `;
    // Имя и текст — через .textContent/.value, чтобы кавычки не ломали разметку.
    const headB = panel.querySelector('.iig-avatar-desc-head b');
    const textarea = panel.querySelector('.iig-avatar-desc-textarea');
    const refresh = () => { headB.textContent = curName(); textarea.value = getDesc(); };
    refresh();

    // ── Селектор персон ({{user}}): активная + все с описанием + весь список персон ST (async) ──
    if (isUser) {
        const sel = panel.querySelector('.iig-avatar-desc-persona');
        const fill = (keys) => {
            const seen = new Set();
            sel.innerHTML = '';
            for (const k of keys) {
                const key = String(k || '').trim();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = personaLabel(key);
                opt.selected = key === curKey();
                sel.appendChild(opt);
            }
        };
        fill([getPersonaKey(), ...Object.keys(getSettings().userDescByKey || {}), curKey()]);
        fetchUserAvatars().then(list => {
            if (!Array.isArray(list) || !document.body.contains(sel)) return;
            const have = new Set(Array.from(sel.options).map(o => o.value));
            fill([...Array.from(sel.options).map(o => o.value), ...list.filter(f => !have.has(String(f || '').trim()))]);
        }).catch(() => {});
        sel.addEventListener('change', () => {
            iigUserDescPersona = sel.value === getPersonaKey() ? null : (sel.value || null);
            refresh();
        });
    }

    textarea.addEventListener('input', () => save(textarea.value));
    panel.querySelector('.iig-avatar-desc-clear').addEventListener('click', () => {
        textarea.value = '';
        save('');
        toastr.info('Описание очищено', 'Генерация картинок', { timeOut: 1500 });
    });
    panel.querySelector('.iig-avatar-desc-generate').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('disabled')) return;
        btn.classList.add('disabled');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
        try {
            let imageB64 = null;
            if (isUser && curKey() !== getPersonaKey()) {
                // Выбрана НЕ активная персона — описываем именно ЕЁ аватарку (ключ = файл авы).
                if (curKey() !== '__default_persona__') imageB64 = await imageUrlToBase64(`/User Avatars/${encodeURIComponent(curKey())}`);
                if (!imageB64) throw new Error('Не удалось загрузить аватарку этой персоны');
            } else {
                // Активная персона / персонаж: ручное фото-референс, если задано, иначе ориг. аватар ST.
                const refs = getCurrentCharacterRefs();
                const ref = isUser ? refs.userRef : refs.charRef;
                imageB64 = ref?.imageBase64 || null;
                if (!imageB64 && ref?.imagePath) imageB64 = await imageUrlToBase64(ref.imagePath);
                if (!imageB64) imageB64 = isUser ? await getUserAvatarBase64() : await getCharacterAvatarBase64();
                if (!imageB64) throw new Error(isUser ? 'Нет аватара: выберите персону в ST' : 'Нет аватара: откройте чат с персонажем');
            }
            const prompt = "Describe this character's physical appearance in detail for consistent image generation. Focus on: face features, eye color, hair color and style, skin tone, body type, distinctive features. Be concise but thorough (2-4 sentences). Write in English.";
            const description = await callVisionApi(imageB64, prompt);
            save(description);
            textarea.value = description;
            toastr.success('Описание сгенерировано', 'Vision AI');
        } catch (err) {
            toastr.error(err.message || 'Ошибка Vision API', 'Vision AI');
        } finally {
            btn.classList.remove('disabled');
            btn.innerHTML = orig;
        }
    });
}

/**
 * Bind events to ref slot elements (upload, name change, delete).
 */
function bindRefSlotEvents() {
    const container = document.getElementById('iig_ref_slots');
    if (!container) return;
    const settings = getSettings();

    // ── Avatar checkboxes ──
    document.getElementById('iig_send_char_avatar')?.addEventListener('change', (e) => {
        settings.sendCharAvatar = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_send_user_avatar')?.addEventListener('change', (e) => {
        settings.sendUserAvatar = e.target.checked;
        saveSettings();
        const sec = document.getElementById('iig_user_avatar_manual_section');
        if (sec) sec.classList.toggle('iig-hidden', !e.target.checked);
    });

    // ── Collapsible photo sections ──
    // ── Inject descriptions toggle (NPC) ──
    document.getElementById('iig_inject_descriptions')?.addEventListener('change', (e) => {
        getSettings().injectDescriptions = e.target.checked;
        saveSettings();
    });

    // ── Avatar Library: добавление аватара + флаги инъекции внешности ──
    const bindAvatarLibAdd = (target) => {
        const addBtn = document.getElementById(`iig_avatar_lib_${target}_add`);
        const fileInput = document.getElementById(`iig_avatar_lib_${target}_file`);
        const nameInput = document.getElementById(`iig_avatar_lib_${target}_name`);
        addBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) return;
            try {
                const resized = await iigFileToResizedBase64(file, 512, true);
                const name = (nameInput?.value || '').trim() || file.name.replace(/\.[^.]+$/, '') || 'Avatar';
                addAvatarItem(name, resized, target);
                if (nameInput) nameInput.value = '';
                if (fileInput) fileInput.value = '';
                renderAvatarGrid(target);
                toastr.success(`Аватар «${name}» добавлен`, 'Генерация картинок', { timeOut: 2000 });
            } catch (err) {
                toastr.error('Не удалось добавить аватар: ' + (err.message || err), 'Генерация картинок');
            }
        });
    };
    bindAvatarLibAdd('char');
    bindAvatarLibAdd('user');

    document.getElementById('iig_inject_avatar_appearance_gen')?.addEventListener('change', (e) => {
        getSettings().injectAvatarAppearanceToGeneration = e.target.checked;
        saveSettings();
    });
    document.getElementById('iig_inject_avatar_appearance_chat')?.addEventListener('change', (e) => {
        getSettings().injectAvatarAppearanceToChatEnabled = e.target.checked;
        saveSettings();
        updateAvatarAppearanceInjection();
    });
    document.getElementById('iig_avatar_appearance_depth')?.addEventListener('input', (e) => {
        const v = Number.parseInt(e.target.value, 10);
        getSettings().avatarAppearanceInjectionDepth = Number.isFinite(v) && v >= 0 ? v : 1;
        saveSettings();
        updateAvatarAppearanceInjection();
    });

    // ── Avatar description textareas ──
    document.getElementById('iig_char_description')?.addEventListener('input', (e) => {
        setCharDescription(e.target.value);
    });
    document.getElementById('iig_user_description')?.addEventListener('input', (e) => {
        setUserDescriptionFor(iigCurrentUserDescKey(), e.target.value);
    });
    // Селектор персоны: выбрал → редактируем описание именно этой персоны.
    const userDescPersonaSel = document.getElementById('iig_user_desc_persona');
    if (userDescPersonaSel) {
        userDescPersonaSel.addEventListener('change', (e) => {
            iigUserDescPersona = e.target.value || null;
            const ta = document.getElementById('iig_user_description');
            if (ta) ta.value = getUserDescriptionFor(iigCurrentUserDescKey());
        });
        // Дополняем список ВСЕМИ персонами ST (асинхронно), сохраняя выбор.
        fetchUserAvatars().then(list => {
            if (!Array.isArray(list) || !document.body.contains(userDescPersonaSel)) return;
            const have = new Set(Array.from(userDescPersonaSel.options).map(o => o.value));
            for (const file of list) {
                const key = String(file || '').trim();
                if (!key || have.has(key)) continue;
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = iigPersonaLabel(key);
                userDescPersonaSel.appendChild(opt);
            }
        }).catch(() => {});
    }

    // ── Vision describe avatar buttons ──
    async function describeAvatarVision(role) {
        const refs = getCurrentCharacterRefs();
        const btn = document.getElementById(role === 'char' ? 'iig_char_desc_vision' : 'iig_user_desc_vision');
        const textarea = document.getElementById(role === 'char' ? 'iig_char_description' : 'iig_user_description');
        if (!btn || !textarea) return;

        btn.classList.add('loading');
        btn.style.pointerEvents = 'none';
        try {
            let imageB64 = null;
            const ref = role === 'char' ? refs.charRef : refs.userRef;
            if (ref.imagePath || ref.imageBase64) {
                imageB64 = ref.imageBase64 || await imageUrlToBase64(ref.imagePath);
            }
            if (!imageB64) {
                imageB64 = role === 'char' ? await getCharacterAvatarBase64() : await getUserAvatarBase64();
            }
            if (!imageB64) throw new Error('Нет изображения для описания');

            const prompt = "Describe this character's physical appearance in detail for consistent image generation. Focus on: face features, eye color, hair color and style, skin tone, body type, distinctive features. Be concise but thorough (2-4 sentences). Write in English.";
            const description = await callVisionApi(imageB64, prompt);
            textarea.value = description;
            if (role === 'char') setCharDescription(description);
            else setUserDescriptionFor(iigCurrentUserDescKey(), description);
            toastr.success('Описание сгенерировано', 'Vision AI');
        } catch (err) {
            toastr.error(err.message || 'Ошибка Vision API', 'Vision AI');
            iigLog('ERROR', `Avatar vision describe (${role}): ${err.message}`);
        } finally {
            btn.classList.remove('loading');
            btn.style.pointerEvents = '';
        }
    }

    document.getElementById('iig_char_desc_vision')?.addEventListener('click', () => describeAvatarVision('char'));
    document.getElementById('iig_user_desc_vision')?.addEventListener('click', () => describeAvatarVision('user'));

    // ── User avatar dropdown ──
    document.getElementById('iig_user_avatar_dropdown_selected')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = document.getElementById('iig_user_avatar_dropdown');
        if (!dropdown) return;
        const wasOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');
        if (!wasOpen) {
            const list = document.getElementById('iig_user_avatar_dropdown_list');
            if (list && list.children.length === 0) loadAndRenderUserAvatars();
        }
    });
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('iig_user_avatar_dropdown');
        if (dropdown && !dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
    document.getElementById('iig_user_avatar_refresh')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.classList.add('loading');
        await loadAndRenderUserAvatars();
        btn.classList.remove('loading');
        toastr.success('Аватары обновлены', 'Генерация картинок');
        document.getElementById('iig_user_avatar_dropdown')?.classList.add('open');
    });

    // ── NPC slot events (delegated) ──
    const npcContainer = document.getElementById('iig_npc_slots');
    if (npcContainer) {
        npcContainer.addEventListener('click', async (e) => {
            // Upload image via thumbnail click
            const thumb = e.target.closest('.iig-ref-slot-thumb');
            if (thumb) {
                const key = thumb.dataset.slotKey;
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*';
                inp.addEventListener('change', async () => {
                    const f = inp.files?.[0];
                    if (!f) return;
                    try {
                        const dataUrl = await iigCropImageDialog(await iigFileToDataUrl(f));
                        const compressed = await compressBase64Image(dataUrl.split(',')[1]);
                        const ref = getRefByKey(key, settings);
                        ref.imageBase64 = compressed;
                        try {
                            ref.imagePath = await saveRefImageToFile(compressed, key);
                            ref.imageBase64 = '';
                        }
                        catch (saveErr) { iigLog('WARN', `Could not save ref to file: ${saveErr.message}`); }
                        if (!ref.name) ref.name = f.name.replace(/\.[^.]+$/, '');
                        saveSettings();
                        renderRefSlots(); bindRefSlotEvents();
                        toastr.success('Референс загружен', 'Генерация картинок');
                    } catch (err) { toastr.error('Ошибка: ' + err.message, 'Генерация картинок'); }
                });
                inp.click(); return;
            }

            // Remove single NPC slot
            const removeBtn = e.target.closest('.iig-npc-slot-remove');
            if (removeBtn) {
                const idx = parseInt(removeBtn.dataset.npcIdx, 10);
                if (isNaN(idx)) return;
                settings.npcReferences.splice(idx, 1);
                saveSettings(); renderRefSlots(); bindRefSlotEvents();
                toastr.info(`NPC ${idx + 1} удалён`, 'Генерация картинок');
                return;
            }
        });

        // Add NPC button
        npcContainer.querySelector('#iig_npc_add')?.addEventListener('click', () => {
            settings.npcReferences.push({ name: '', aliases: [], imageBase64: '', imagePath: '', description: '', enabled: true });
            saveSettings(); renderRefSlots(); bindRefSlotEvents();
        });

        // Clear all NPCs
        npcContainer.querySelector('#iig_npc_clear_all')?.addEventListener('click', () => {
            if (!settings.npcReferences.length) return;
            if (!confirm('Очистить все NPC?')) return;
            settings.npcReferences = [];
            saveSettings(); renderRefSlots(); bindRefSlotEvents();
            toastr.info('Все NPC удалены', 'Генерация картинок');
        });

        npcContainer.querySelectorAll('.iig-ref-name-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const key = e.target.dataset.slotKey;
                const ref = getRefByKey(key, settings);
                ref.name = e.target.value;
                saveSettings();
            });
        });

        // ── NPC description textareas ──
        npcContainer.querySelectorAll('.iig-npc-desc-input').forEach(ta => {
            ta.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.npcIdx, 10);
                if (!isNaN(idx) && settings.npcReferences[idx]) {
                    settings.npcReferences[idx].description = e.target.value;
                    saveSettings();
                }
            });
        });

        // ── NPC aliases (доп. имена-триггеры, через запятую) ──
        npcContainer.querySelectorAll('.iig-npc-aliases').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.npcIdx, 10);
                if (!isNaN(idx) && settings.npcReferences[idx]) {
                    settings.npcReferences[idx].aliases = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                    saveSettings();
                }
            });
        });

        // ── NPC enabled toggle ──
        npcContainer.querySelectorAll('.iig-npc-enabled').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.npcIdx, 10);
                if (!isNaN(idx) && settings.npcReferences[idx]) {
                    settings.npcReferences[idx].enabled = e.target.checked;
                    saveSettings();
                    e.target.closest('.iig-npc-card')?.classList.toggle('iig-npc-card-disabled', !e.target.checked);
                }
            });
        });

        // ── NPC vision describe buttons ──
        npcContainer.querySelectorAll('.iig-npc-desc-vision').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.npcIdx, 10);
                const npc = settings.npcReferences?.[idx];
                if (!npc) return;
                const ta = npcContainer.querySelector(`.iig-npc-desc-input[data-npc-idx="${idx}"]`);
                if (!ta) return;

                btn.classList.add('loading');
                btn.style.pointerEvents = 'none';
                try {
                    let imageB64 = null;
                    if (npc.imageBase64) imageB64 = npc.imageBase64;
                    else if (npc.imagePath) imageB64 = await imageUrlToBase64(npc.imagePath);
                    if (!imageB64) throw new Error('Нет изображения NPC');

                    const visionPrompt = "Describe this character's physical appearance in detail for consistent image generation. Focus on: face features, eye color, hair color and style, skin tone, body type, distinctive features. Be concise but thorough (2-4 sentences). Write in English.";
                    const description = await callVisionApi(imageB64, visionPrompt);
                    ta.value = description;
                    npc.description = description;
                    saveSettings();
                    toastr.success(`Описание NPC «${npc.name || idx + 1}» сгенерировано`, 'Vision AI');
                } catch (err) {
                    toastr.error(err.message || 'Ошибка Vision API', 'Vision AI');
                    iigLog('ERROR', `NPC vision describe (${idx}): ${err.message}`);
                } finally {
                    btn.classList.remove('loading');
                    btn.style.pointerEvents = '';
                }
            });
        });
    }
}

/**
 * Bind lorebook UI events.
 */
function bindLorebookEvents() {
    const settings = getSettings();

    // Lorebook selector
    document.getElementById('iig_lorebook_select')?.addEventListener('change', (e) => {
        lorebookSetActive(e.target.value, settings);
        saveSettings();
        renderLorebookUI();
        bindLorebookRefCardEvents();
    });

    // Create lorebook
    document.getElementById('iig_lorebook_add')?.addEventListener('click', () => {
        const name = (prompt('Название нового лорбука:') || '').trim();
        if (!name) return;
        lorebookCreate(name, settings);
        saveSettings();
        renderLorebookUI();
        bindLorebookRefCardEvents();
        toastr.success(`Лорбук «${name}» создан`, 'Генерация картинок');
    });

    // Rename lorebook
    document.getElementById('iig_lorebook_rename')?.addEventListener('click', () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        const name = (prompt('Новое название:', active.name) || '').trim();
        if (!name) return;
        lorebookRename(active.id, name, settings);
        saveSettings();
        renderLorebookUI();
        toastr.success(`Переименован: ${name}`, 'Генерация картинок');
    });

    // Enable/disable active lorebook
    document.getElementById('iig_lorebook_enabled')?.addEventListener('change', (e) => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        lorebookSetEnabled(active.id, e.target.checked, settings);
        saveSettings();
        renderLorebookUI();
        toastr.info(`Лорбук «${active.name}» ${e.target.checked ? 'включён' : 'выключен'}`, 'Генерация картинок');
    });

    // Send reference descriptions toggle
    document.getElementById('iig_lorebook_send_descriptions')?.addEventListener('change', (e) => {
        settings.sendRefDescriptions = e.target.checked;
        saveSettings();
    });

    // Delete lorebook
    document.getElementById('iig_lorebook_delete')?.addEventListener('click', () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        if (ensureLorebooks(settings).length <= 1) {
            toastr.warning('Нельзя удалить единственный лорбук', 'Генерация картинок');
            return;
        }
        if (!confirm(`Удалить лорбук «${active.name}» и все его референсы?`)) return;
        lorebookRemove(active.id, settings);
        saveSettings();
        renderLorebookUI();
        bindLorebookRefCardEvents();
        toastr.info('Лорбук удалён', 'Генерация картинок');
    });

    // Add ref
    document.getElementById('iig_lorebook_add_ref')?.addEventListener('click', () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        active.refs.push(normalizeReferenceEntry({}));
        saveSettings();
        renderLorebookUI();
        bindLorebookRefCardEvents();
    });

    // Import from file
    document.getElementById('iig_lorebook_import_file')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,.iig.json';
        inp.addEventListener('change', async () => {
            const file = inp.files?.[0];
            if (!file) return;
            try {
                const result = await importLorebookFromFile(file);
                renderLorebookUI();
                bindLorebookRefCardEvents();
                toastr.success(`Импортировано: ${result.refsCount} референсов, ${result.imagesDownloaded} картинок`, 'Генерация картинок');
            } catch (err) {
                toastr.error(`Ошибка импорта: ${err.message}`, 'Генерация картинок');
            }
        });
        inp.click();
    });

    // Import from URL
    document.getElementById('iig_lorebook_import_url')?.addEventListener('click', async () => {
        const url = (prompt('URL JSON-файла лорбука:') || '').trim();
        if (!url) return;
        try {
            const result = await importLorebookFromUrl(url);
            renderLorebookUI();
            bindLorebookRefCardEvents();
            toastr.success(`Импортировано: ${result.refsCount} референсов, ${result.imagesDownloaded} картинок`, 'Генерация картинок');
        } catch (err) {
            toastr.error(`Ошибка импорта: ${err.message}`, 'Генерация картинок');
        }
    });

    // Export
    document.getElementById('iig_lorebook_export')?.addEventListener('click', () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        const json = buildLorebookExportJson(active);
        const fileName = lorebookFileNameFromTitle(active.name);
        triggerBrowserDownload(fileName, JSON.stringify(json, null, 2));
        toastr.success(`Экспорт: ${fileName}`, 'Генерация картинок');
    });

    // Load references by URL (bulk) — скачивает картинки и добавляет refs в активный лорбук
    document.getElementById('iig_lorebook_load_ref')?.addEventListener('click', async () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        const raw = (prompt('URL изображений — по одному на строку или через запятую:') || '').trim();
        if (!raw) return;
        const urls = raw.split(/[\s,]+/).map(u => u.trim()).filter(Boolean);
        if (urls.length === 0) return;
        const slots = MAX_LOREBOOK_REFS - active.refs.length;
        if (slots <= 0) {
            toastr.warning(`Достигнут лимит референсов: ${MAX_LOREBOOK_REFS}`, 'Генерация картинок');
            return;
        }
        const queue = urls.slice(0, slots);
        const importedRefs = [];
        let fail = 0;
        for (let i = 0; i < queue.length; i++) {
            try {
                const dataUrl = await imageUrlToDataUrl(queue[i]);
                if (!dataUrl) throw new Error('empty');
                const b64 = dataUrl.split(',')[1];
                const compressed = await compressBase64Image(b64, 768, 0.8);
                const imagePath = await saveRefImageToFile(compressed, `lorebook_ref_${active.refs.length + i}`);
                let name = '';
                try { name = decodeURIComponent(new URL(queue[i]).pathname.split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (_) {}
                importedRefs.push(normalizeReferenceEntry({ name: name || `reference-${i + 1}`, imagePath }));
            } catch (_) {
                fail++;
            }
        }
        active.refs.unshift(...importedRefs);
        saveSettings();
        renderLorebookUI();
        bindLorebookRefCardEvents();
        toastr.success(`Загружено референсов: ${importedRefs.length}${fail ? `, ошибок: ${fail}` : ''}`, 'Генерация картинок');
    });

    // Bind ref card events
    bindLorebookRefCardEvents();
}

function bindLorebookRefCardEvents() {
    const container = document.getElementById('iig_lorebook_refs_list');
    if (!container) return;
    const settings = getSettings();
    const active = getActiveLorebook(settings);
    if (!active) return;

    for (const row of container.querySelectorAll('.iig-lb-ref-row')) {
        const index = parseInt(row.dataset.refIndex, 10);
        const ref = active.refs[index];
        if (!ref) continue;

        // Enable/disable
        row.querySelector('.iig-lb-ref-enabled')?.addEventListener('change', (e) => {
            ref.enabled = e.target.checked;
            row.classList.toggle('iig-lb-ref-row-disabled', !ref.enabled);
            saveSettings();
            updateLorebookStatus();
        });

        // Name
        row.querySelector('.iig-lb-ref-name')?.addEventListener('input', (e) => {
            ref.name = e.target.value;
            saveSettings();
        });

        // Description
        row.querySelector('.iig-lb-ref-description')?.addEventListener('input', (e) => {
            ref.description = e.target.value;
            saveSettings();
        });

        // Group
        row.querySelector('.iig-lb-ref-group')?.addEventListener('input', (e) => {
            ref.group = e.target.value;
            saveSettings();
        });

        // Secondary keys
        row.querySelector('.iig-lb-ref-secondary')?.addEventListener('input', (e) => {
            ref.secondaryKeys = e.target.value;
            saveSettings();
        });

        // Priority
        row.querySelector('.iig-lb-ref-priority')?.addEventListener('input', (e) => {
            ref.priority = parseInt(e.target.value, 10) || 0;
            saveSettings();
        });

        // Always/match toggle
        row.querySelector('.iig-lb-ref-always')?.addEventListener('change', (e) => {
            ref.matchMode = e.target.checked ? 'always' : 'match';
            const label = e.target.closest('label')?.querySelector('span');
            if (label) label.textContent = e.target.checked ? 'Всегда' : 'По совпадению';
            saveSettings();
            updateLorebookStatus();
        });

        // Regex toggle
        row.querySelector('.iig-lb-ref-regex')?.addEventListener('change', (e) => {
            ref.useRegex = e.target.checked;
            saveSettings();
        });

        // File upload
        row.querySelector('.iig-lb-ref-file')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const dataUrl = await iigCropImageDialog(await iigFileToDataUrl(file));
                const compressed = await compressBase64Image(dataUrl.split(',')[1], 768, 0.8);
                ref.imagePath = await saveRefImageToFile(compressed, `lorebook_ref_${index}`);
                if (!ref.name) ref.name = file.name.replace(/\.[^.]+$/, '');
                saveSettings();
                renderLorebookUI();
                bindLorebookRefCardEvents();
                toastr.success('Изображение загружено', 'Генерация картинок');
            } catch (err) {
                toastr.error('Ошибка загрузки: ' + err.message, 'Генерация картинок');
            }
            e.target.value = '';
        });

        // Upload by URL
        row.querySelector('.iig-lb-ref-upload-url')?.addEventListener('click', async () => {
            const url = (prompt('URL изображения:') || '').trim();
            if (!url) return;
            try {
                let dataUrl = await imageUrlToDataUrl(url);
                if (!dataUrl) throw new Error('Не удалось загрузить');
                dataUrl = await iigCropImageDialog(dataUrl);
                const b64 = dataUrl.split(',')[1];
                const compressed = await compressBase64Image(b64, 768, 0.8);
                ref.imagePath = await saveRefImageToFile(compressed, `lorebook_ref_${index}`);
                if (!ref.name) {
                    try { ref.name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (_) {}
                }
                saveSettings();
                renderLorebookUI();
                bindLorebookRefCardEvents();
                toastr.success('Изображение загружено по URL', 'Генерация картинок');
            } catch (err) {
                toastr.error('Ошибка загрузки: ' + err.message, 'Генерация картинок');
            }
        });

        // Delete
        row.querySelector('.iig-lb-ref-remove')?.addEventListener('click', () => {
            active.refs.splice(index, 1);
            saveSettings();
            renderLorebookUI();
            bindLorebookRefCardEvents();
        });

        // Vision AI description
        row.querySelector('.iig-lb-ref-vision')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.classList.add('loading');
            try {
                const description = await generateReferenceDescription(ref.id);
                const descInput = row.querySelector('.iig-lb-ref-description');
                if (descInput) descInput.value = description;
                toastr.success('Описание сгенерировано', 'Vision AI');
            } catch (err) {
                toastr.error('Vision: ' + err.message, 'Генерация картинок');
            } finally {
                btn.classList.remove('loading');
            }
        });

        // Move up
        row.querySelector('.iig-lb-ref-move-up')?.addEventListener('click', () => {
            if (index <= 0) return;
            [active.refs[index - 1], active.refs[index]] = [active.refs[index], active.refs[index - 1]];
            saveSettings();
            renderLorebookUI();
            bindLorebookRefCardEvents();
        });

        // Move down
        row.querySelector('.iig-lb-ref-move-down')?.addEventListener('click', () => {
            if (index >= active.refs.length - 1) return;
            [active.refs[index], active.refs[index + 1]] = [active.refs[index + 1], active.refs[index]];
            saveSettings();
            renderLorebookUI();
            bindLorebookRefCardEvents();
        });
    }
}

function bindVisionSettingsEvents() {
    const settings = getSettings();

    document.getElementById('iig_vision_endpoint')?.addEventListener('input', (e) => {
        settings.visionEndpoint = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_vision_api_key')?.addEventListener('input', (e) => {
        settings.visionApiKey = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_vision_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_vision_api_key');
        const icon = document.querySelector('#iig_vision_key_toggle i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });

    document.getElementById('iig_vision_model')?.addEventListener('change', (e) => {
        settings.visionModel = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_vision_refresh_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        try {
            const models = await fetchVisionModels();
            const select = document.getElementById('iig_vision_model');
            if (!select) return;
            const currentModel = settings.visionModel;
            select.innerHTML = '<option value="">-- Выберите модель --</option>';
            for (const model of models) {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                option.selected = model === currentModel;
                select.appendChild(option);
            }
            toastr.success(`Vision: найдено моделей: ${models.length}`, 'Генерация картинок');
        } catch (error) {
            toastr.error('Ошибка загрузки vision-моделей', 'Генерация картинок');
        } finally {
            btn.classList.remove('loading');
        }
    });

    document.getElementById('iig_vision_prompt')?.addEventListener('input', (e) => {
        settings.visionPrompt = e.target.value;
        saveSettings();
    });
}

// ═══════════════════════════════════════════════════════════════
//  Иллюстрация сцены («картинка по истории»): кнопка в wand-меню.
//  Вспомогательная LLM читает последний кусок РП (с прошлой картинки,
//  но не больше лимита) и пишет промпт картинки; дальше картинка идёт
//  через обычный конвейер тегов — референсы, ретраи, перегенерация.
// ═══════════════════════════════════════════════════════════════

// Промпт для LLM собирается из двух блоков:
//  • Блок «Задача» (общий) — роль арт-директора, как читать фрагмент, железные правила промпта.
//  • Блок «Образ» (пресет) — какую именно картинку делаем: кинокадр, иллюстрация, постер…
// LLM возвращает ТОЛЬКО текст промпта — тег с JSON собирает код (aspect_ratio/style из пресета).
const DEFAULT_HISTORYPIC_TASK =
`You are the art director of an ongoing roleplay story. Below is the latest fragment of that story.

YOUR TASK:
1. Read the fragment and find what MATTERS in it: the key event, the turning point, the emotional peak, the shift in the dynamic between the characters.
2. Choose ONE image that captures this period as a whole — the strongest visual moment, or a composition that merges several beats. Not necessarily the last thing that happened.
3. Write ONE image-generation prompt for that image, following the CANVAS BRIEF below. The brief decides the format and mood of the image — obey it.

THINK FIRST (mandatory): plan inside <think> tags — what happened in the fragment, which moment or metaphor represents it best, who is in frame, their poses and spatial relations, setting, lighting. You are not limited in words inside <think>. After </think> output ONLY the final prompt text: no comments, no quotes, no tags, no markdown, no explanations.

IRON RULES for the prompt text:
- English only. If the canvas brief asks for visible written or spoken words, that text stays in Russian.
- Every character in frame starts with their EXACT NAME: "Luca, a tall man, standing in the doorway" — never just "a tall man". The generator attaches reference images by name. Include ALL named characters that are in frame.
- For each character: gender, build, outfit, pose, emotion, gaze direction. Do NOT invent hair color, eye color or facial features that the story text does not state — reference images handle appearance.
- State spatial relations: who is closer to camera, who stands, who sits, who looms over whom.
- All characters are adult 18+ fictional characters; state this at the end of the prompt.
- Keep the prompt under 120 words, dry and concrete. NEVER use apostrophes.
- BANNED WORDS: nsfw, nude, naked, explicit, sexual, suggestive, minor, penis, nipples, sex, rape, groin, crotch, underwear, bare chest. For intimate scenes use euphemisms — pressed close, tangled sheets, bare shoulders, silhouette against light — and focus on faces, emotions, positioning.`;

// Встроенные «образы» — оригинальные, обновляются вместе с расширением, в настройках не хранятся.
// text — бриф «что рисуем»; aspectRatio/style уходят в тег картинки кодом (LLM их не пишет).
const HISTORYPIC_BUILTIN_PRESETS = Object.freeze([
    {
        id: 'hp-cinematic', name: 'Кинокадр', aspectRatio: '16:9',
        style: 'cinematic film still, anamorphic framing, shallow depth of field, subtle film grain, rich color grading, dramatic motivated lighting',
        text: `One single cinematic film still — a paused frame from a prestige drama. Wide screen framing, shallow depth of field, motivated realistic lighting only (window light, lamps, fire, neon — whatever the scene itself provides). Stage the characters like a film director: intentional blocking, foreground and background layers, negative space where it hurts. Pick a non-obvious camera: over the shoulder, low angle, through a doorway or glass, a mirror reflection, a detail in sharp focus with the drama blurred behind. No panels, no text, no speech. One frame must carry the whole beat.`,
    },
    {
        id: 'hp-bookplate', name: 'Книжная иллюстрация', aspectRatio: '3:4',
        style: 'classic novel illustration, painterly full page plate, visible brushwork, rich textures, warm muted palette, storybook composition',
        text: `One full-page painted illustration, like a plate from a beautifully published novel. The scene is shown as a whole: characters inside a living environment that tells the story with them — the room, the weather, the small telling objects. Composition is deliberate and slightly theatrical, with one clear focal point and supporting details that reward a second look. Light is painterly and atmospheric. A thin decorative border or a vignette edge is welcome when it fits the mood of the story. No text, no panels.`,
    },
    {
        id: 'hp-anime', name: 'Аниме-кадр', aspectRatio: '16:9',
        style: 'anime keyframe, high quality TV anime screencap, clean lineart, expressive faces, soft cel shading, atmospheric background art',
        text: `One key frame from a high-budget anime adaptation of this story — the shot the studio would put in the trailer. Prioritize emotion: expressive faces and eyes, body language pushed slightly past realism. Choose either an intense close-up with a dramatic background treatment, or a wide atmospheric scene where small figures sit inside overwhelming scenery — whichever the fragment calls for. Light and air matter: god rays, dust, rain, the glow of screens or street lights. No panels, no speech bubbles, no text.`,
    },
    {
        id: 'hp-poster', name: 'Постер эпизода', aspectRatio: '2:3',
        style: 'dramatic episode poster art, painted montage, cinematic lighting, rich color, high detail',
        text: `One vertical poster for this episode of the story, like key art for a series. The main characters stand in the foreground in expressive poses that show their current dynamic — closeness, tension, opposition. Behind and around them a montage: translucent symbols, locations and charged objects from the fragment woven into the background; larger-than-life faces fading into the sky are allowed. Dramatic unified lighting ties every layer together. Absolutely no text, no title, no logos — the image alone sells the episode.`,
    },
    {
        id: 'hp-photo', name: 'Момент-фото', aspectRatio: '3:4',
        style: 'candid 35mm photograph, natural ambient light, shallow focus, authentic colors, documentary feel',
        text: `One candid photograph taken inside the story world, as if someone present grabbed a camera or a phone at exactly the right second. Imperfect, honest framing: subjects caught mid-motion or mid-emotion, maybe slightly off-center, someone unaware of the camera. Only the natural ambient light of the actual scene. Small environmental details keep it real — clutter, steam over a cup, a coat half off. Intimate and warm or awkward and raw, following the fragment. No posing for the viewer, no text.`,
    },
    {
        id: 'hp-symbol', name: 'Символ', aspectRatio: '1:1',
        style: 'symbolic minimalist illustration, poetic still life, single dramatic light source, rich shadow, painterly detail',
        text: `One symbolic image that stands in for what happened — no full characters, or characters reduced to hands, silhouettes or reflections. Choose one strong metaphor from the fragment: a charged object, two hands almost touching, a broken or mended thing, an empty chair, light dying or breaking through. Compose it like a poetic still life: minimal elements, one dominant light source, meaningful shadow, generous negative space. A viewer who read the fragment must feel a punch of recognition. No text.`,
    },
]);

// Нормализация своих пресетов + миграция старого historyPicPrompt в standalone-пресет.
function ensureHistoryPicPresets(settings = getSettings()) {
    if (!Array.isArray(settings.historyPicPresets)) settings.historyPicPresets = [];
    settings.historyPicPresets = settings.historyPicPresets.map((p, i) => ({
        id: String(p?.id || `iig-hp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`),
        name: String(p?.name || `Свой образ ${i + 1}`).trim(),
        text: String(p?.text || ''),
        aspectRatio: String(p?.aspectRatio || '').trim(),
        style: String(p?.style || '').trim(),
        standalone: !!p?.standalone,
    }));
    // Legacy-миграция: старый полный шаблон становится standalone-пресетом (дедуп по тексту —
    // старый профиль может принести historyPicPrompt повторно) и остаётся активным.
    const legacy = String(settings.historyPicPrompt || '').trim();
    if (legacy) {
        let preset = settings.historyPicPresets.find(p => p.text.trim() === legacy);
        if (!preset) {
            preset = {
                id: `iig-hp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: 'Мой промпт', text: legacy, aspectRatio: '', style: '', standalone: true,
            };
            settings.historyPicPresets.push(preset);
        }
        settings.historyPicPresetId = preset.id;
        settings.historyPicPrompt = '';
    }
    if (!findHistoryPicPreset(settings.historyPicPresetId, settings)) {
        settings.historyPicPresetId = HISTORYPIC_BUILTIN_PRESETS[0].id;
    }
    return settings.historyPicPresets;
}

function findHistoryPicPreset(id, settings = getSettings()) {
    if (!id) return null;
    return HISTORYPIC_BUILTIN_PRESETS.find(p => p.id === id)
        || (Array.isArray(settings.historyPicPresets) ? settings.historyPicPresets.find(p => p.id === id) : null)
        || null;
}

function isHistoryPicBuiltin(id) {
    return HISTORYPIC_BUILTIN_PRESETS.some(p => p.id === id);
}

function getActiveHistoryPicPreset(settings = getSettings()) {
    ensureHistoryPicPresets(settings);
    return findHistoryPicPreset(settings.historyPicPresetId, settings) || HISTORYPIC_BUILTIN_PRESETS[0];
}

// Шаблон запроса к LLM: «Задача» + «Образ», либо один пресет целиком (standalone).
function buildHistoryPicLlmTemplate(settings, preset) {
    if (preset?.standalone) return String(preset.text || '').trim() || DEFAULT_HISTORYPIC_TASK;
    const task = String(settings.historyPicTaskPrompt || '').trim() || DEFAULT_HISTORYPIC_TASK;
    const canvas = String(preset?.text || '').trim();
    return canvas ? `${task}\n\nCANVAS BRIEF (the image to create):\n${canvas}` : task;
}

// Хвост к запросу при включённой цитате: LLM дописывает отдельной строкой эпиграф момента.
const HISTORYPIC_QUOTE_APPENDIX =
`\n\nQUOTE (mandatory): after the prompt, output one more separate line, exactly in this form:
QUOTE: одна короткая пронзительная строка на русском (3-15 слов) — дословная реплика из фрагмента или выжимка сути момента.
It will be shown next to the picture as an epigraph. No other commentary after it.`;

// Вытаскивает строку «QUOTE: …» из ответа LLM. Возвращает { quote, rest } —
// rest уходит в cleanHistoryPicResponse как раньше.
function extractHistoryPicQuote(raw) {
    let s = String(raw || '');
    // Сначала режем размышления: QUOTE внутри <think> — черновик, не берём.
    s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
    let quote = '';
    s = s.replace(/^\s*(?:QUOTE|ЦИТАТА)\s*[:—-]\s*(.+)\s*$/im, (_, q) => { quote = q; return ''; });
    quote = quote
        .replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/^["'«»]+|["'«»]+$/g, '').trim();
    if (quote.length > 200) quote = quote.slice(0, 200).trim() + '…';
    return { quote, rest: s };
}

// Граница периода — прошлая «Иллюстрация сцены» (extra.iig_history_pic), а НЕ любая
// картинка: модель часто вставляет картинки прямо в РП-посты, и граница «любая картинка»
// резала кусок до минимума вместо лимита юзера (жалоба: «почему 4, если стоит 20»).

// Текст сообщения без картиночной разметки — в кусок истории для LLM идёт только сюжет.
function historyPicCleanText(raw) {
    let s = String(raw || '');
    s = s.replace(/\[IMG:GEN:\{[\s\S]*?\}\]/g, ' ');
    s = s.replace(/\[(?:IMG|VID):[^\]]*\]/g, ' ');
    s = s.replace(/<video\b[^>]*>[\s\S]*?<\/video\s*>/gi, ' ');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    // Ограничиваем длину поста: LLM нужен сюжет, а не простыня целиком.
    if (s.length > 1500) s = s.slice(0, 1500) + '…';
    return s;
}

// Кусок истории для LLM: сообщения ПОСЛЕ прошлой иллюстрации сцены, максимум N
// (настройка historyPicMaxMessages). Если иллюстраций не было — просто последние N.
// Даже если иллюстрация совсем свежая, добираем минимум 3 сообщения, чтобы LLM было
// из чего писать.
function collectHistoryPicSlice() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const cap = Math.max(2, Math.min(100, parseInt(settings.historyPicMaxMessages, 10) || 20));
    const HISTORYPIC_MIN = 3;
    const lines = [];
    for (let i = context.chat.length - 1; i >= 0 && lines.length < cap; i--) {
        const m = context.chat[i];
        if (!m) continue;
        // Граница — прошлая иллюстрация сцены (в т.ч. скрытая is_system), не раньше минимума.
        if (m.extra?.iig_history_pic && lines.length >= HISTORYPIC_MIN) break;
        if (m.is_system) continue;
        const text = historyPicCleanText(m.mes);
        if (text) lines.push(`${m.name || (m.is_user ? 'User' : 'Narrator')}: ${text}`);
    }
    lines.reverse();
    return lines.join('\n');
}

// Запрос к LLM, которая пишет промпт: 'chat' — основная модель ST (generateQuietPrompt),
// 'vision' — эндпоинт из таба Vision (текстовый вызов, без картинки).
async function callHistoryPicLlm(promptText) {
    const settings = getSettings();
    if (settings.historyPicLlm === 'vision') {
        const { endpoint, apiKey, model } = getEffectiveVisionConfig();
        if (!endpoint || !apiKey || !model) {
            throw new Error('Vision API не настроен: заполните эндпоинт/ключ/модель в табе Vision или переключите «Промпт пишет» на основную модель чата');
        }
        const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: promptText }],
                max_tokens: 600,
                temperature: 0.7,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Vision API ${response.status}: ${String(errorText).slice(0, 300)}`);
        }
        const result = await response.json();
        return String(result?.choices?.[0]?.message?.content || '').trim();
    }
    const context = SillyTavern.getContext();
    // generateRaw — ГОЛЫЙ запрос к основному API: без пресета, джейлбрейка и истории чата.
    // Через generateQuietPrompt модель оставалась в роли и вместо промпта писала РП-пост.
    if (typeof context.generateRaw === 'function') {
        const result = await context.generateRaw({ prompt: promptText });
        return String(result || '').trim();
    }
    if (typeof context.generateQuietPrompt !== 'function') throw new Error('Основная модель чата недоступна (нет generateRaw/generateQuietPrompt)');
    const result = await context.generateQuietPrompt({ quietPrompt: promptText, skipWIAN: true });
    return String(result || '').trim();
}

// Ответ LLM → чистый промпт картинки: режем размышления/кавычки/markdown.
// Пресет юзера может велеть модели писать картиночные ТЕГИ — если модель вернула
// готовый тег (новый или legacy формат), вытаскиваем prompt прямо из него.
function cleanHistoryPicResponse(raw) {
    let s = String(raw || '');
    s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
    s = s.replace(/<\/?think\b[^>]*>/gi, '');
    // Новый формат: <img data-iig-instruction='{"prompt":"..."}'>
    const instrMatch = s.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
    if (instrMatch) {
        const json = instrMatch[2]
            .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
            .replace(/&apos;/g, "'").replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
        try {
            const data = JSON.parse(json);
            if (data.prompt) s = String(data.prompt);
        } catch (_) {
            try {
                const data = JSON.parse(json.replace(/'/g, '"'));
                if (data.prompt) s = String(data.prompt);
            } catch (_) { /* не распарсилось — работаем с текстом как есть */ }
        }
    } else {
        // Legacy формат: [IMG:GEN:{...}]
        const tagMatch = s.match(/\[IMG:GEN:(\{[\s\S]*?\})\]/);
        if (tagMatch) {
            try {
                const data = JSON.parse(tagMatch[1].replace(/'/g, '"'));
                if (data.prompt) s = String(data.prompt);
            } catch (_) { /* не распарсилось — работаем с текстом как есть */ }
        }
    }
    s = s.replace(/<[^>]*>/g, ' '); // остатки HTML-разметки — в промпте им не место
    s = s.replace(/```[a-z]*\n?/gi, ' ').replace(/```/g, ' ');
    s = s.replace(/^\s*(?:prompt|промпт)\s*[:—-]\s*/i, '');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^["'«]+|["'»]+$/g, '').trim();
    // Апострофы → типографские: промпт живёт в single-quoted HTML-атрибуте
    // data-iig-instruction, обычный апостроф закрыл бы атрибут раньше времени.
    s = s.replace(/'/g, '’');
    // Угловые скобки убираем совсем — чтобы кусок промпта не приняли за HTML-тег.
    s = s.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
    return s;
}

let historyPicBusy = false;

// Кнопка «Иллюстрация сцены»: собрать кусок РП → LLM пишет промпт → вставить в чат
// новое сообщение с тегом [IMG:GEN:{...}] → processMessageTags генерирует как обычно.
async function generateHistoryPicture() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    if (historyPicBusy) { toastr.info('Уже генерирую — подождите', 'Иллюстрация сцены', { timeOut: 2000 }); return; }
    if (!settings.enabled) { toastr.warning('Расширение выключено', 'Иллюстрация сцены'); return; }
    try { validateSettings(); } catch (e) { toastr.error(e.message, 'Иллюстрация сцены'); return; }
    historyPicBusy = true;
    try {
        const history = collectHistoryPicSlice();
        if (!history) { toastr.warning('В чате нет текста для иллюстрации', 'Иллюстрация сцены'); return; }
        const lastAi = [...context.chat].reverse().find(m => m && !m.is_user && !m.is_system);
        const charName = lastAi?.name || context.name2 || 'Narrator';
        const userName = context.name1 || 'User';
        const preset = getActiveHistoryPicPreset(settings);
        let tpl = buildHistoryPicLlmTemplate(settings, preset);
        if (settings.historyPicQuote !== false) tpl += HISTORYPIC_QUOTE_APPENDIX;
        // Функции-заменители: '$' в тексте РП не должен трактоваться как спецпаттерн replace.
        let llmPrompt = tpl
            .replaceAll('{{history}}', () => history)
            .replaceAll('{{char}}', () => charName)
            .replaceAll('{{user}}', () => userName);
        // Юзерский шаблон без {{history}} — дописываем кусок РП в конец, иначе LLM нечего сводить.
        if (!tpl.includes('{{history}}')) llmPrompt += `\n\nRoleplay fragment:\n${history}`;
        const llmName = settings.historyPicLlm === 'vision' ? 'Vision API' : 'модель чата';
        toastr.info(`${llmName} пишет промпт (сообщений: ${history.split('\n').length})…`, 'Иллюстрация сцены', { timeOut: 30000 });
        const rawResponse = await callHistoryPicLlm(llmPrompt);
        const { quote, rest } = settings.historyPicQuote !== false
            ? extractHistoryPicQuote(rawResponse)
            : { quote: '', rest: rawResponse };
        const imgPrompt = cleanHistoryPicResponse(rest);
        iigLog('INFO', `history pic prompt: ${imgPrompt.slice(0, 200)}`);
        if (!imgPrompt || imgPrompt.length < 10) {
            throw new Error(`LLM не вернула промпт (ответ: «${String(rawResponse).slice(0, 120)}»)`);
        }
        // Новое сообщение с тегом НОВОГО формата (<img data-iig-instruction>): конвейер сам
        // сгенерирует картинку, подставит src и повесит кнопку перегенерации. Legacy-формат
        // [IMG:GEN:...] не используем: у завершённого маркера [IMG:✓:путь] нет отрисовки,
        // после перерендера он остаётся в сообщении сырым текстом.
        // aspect_ratio и style кладёт КОД из пресета (LLM их не пишет — раньше выбрасывались).
        const instruction = { prompt: imgPrompt };
        const presetAr = String(preset.aspectRatio || '').trim();
        if (VALID_ASPECT_RATIOS.includes(presetAr)) instruction.aspect_ratio = presetAr;
        // Апострофы → типографские: JSON живёт в single-quoted HTML-атрибуте.
        const presetStyle = String(preset.style || '').trim().replace(/'/g, '’');
        if (presetStyle) instruction.style = presetStyle;
        // Цитата-эпиграф — над картинкой; скрытое сообщение (is_system) видно в чате,
        // но не уходит в промпт следующих генераций.
        const quoteHtml = quote ? `<blockquote class="iig-scene-quote">${sanitizeForHtml(quote)}</blockquote>\n` : '';
        const message = {
            name: charName,
            is_user: false,
            is_system: settings.historyPicHideFromContext !== false,
            send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : Date.now(),
            mes: `${quoteHtml}<img data-iig-instruction='${JSON.stringify(instruction)}' src="[IMG:GEN]" alt="Иллюстрация сцены">`,
            extra: { iig_history_pic: true },
        };
        context.chat.push(message);
        const messageId = context.chat.length - 1;
        context.addOneMessage(message, { scroll: true });
        await context.saveChat();
        // CHARACTER_MESSAGE_RENDERED для addOneMessage не стреляет — запускаем конвейер сами
        // (onMessageReceived = processMessageTags + кнопка перегенерации + зум/фуллскрин).
        await onMessageReceived(messageId);
    } catch (e) {
        iigLog('ERROR', 'history picture failed:', e.message);
        toastr.error(String(e.message || e).slice(0, 300), 'Иллюстрация сцены', { timeOut: 7000 });
    } finally {
        historyPicBusy = false;
    }
}

// Пункт «Иллюстрация сцены» в меню «волшебной палочки» (#extensionsMenu).
// Попап с wand-кнопки: быстрый выбор образа/LLM/лимита + галки цитаты и скрытия,
// затем запуск генерации. Вёрстка колонкой — нормально встаёт и на телефоне.
async function openHistoryPicDialog() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    if (!settings.enabled) { toastr.warning('Расширение выключено', 'Иллюстрация сцены'); return; }
    if (historyPicBusy) { toastr.info('Уже генерирую — подождите', 'Иллюстрация сцены', { timeOut: 2000 }); return; }
    // Старые ST без штатных попапов — генерим сразу, как раньше.
    if (typeof context.callGenericPopup !== 'function' || !context.POPUP_TYPE?.CONFIRM) {
        return generateHistoryPicture();
    }
    ensureHistoryPicPresets(settings);
    const active = getActiveHistoryPicPreset(settings);
    const wrap = document.createElement('div');
    wrap.className = 'iig-hp-dialog';
    const opt = (p) => `<option value="${sanitizeForHtml(p.id)}" ${p.id === active.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}${p.standalone ? ' (полный)' : ''}</option>`;
    wrap.innerHTML = `
        <h3 class="iig-hp-dialog-title"><i class="fa-solid fa-panorama"></i> Иллюстрация сцены</h3>
        <label>Образ (что рисуем)
            <select id="iig_hpd_preset" class="text_pole">
                <optgroup label="Встроенные">${HISTORYPIC_BUILTIN_PRESETS.map(opt).join('')}</optgroup>
                ${settings.historyPicPresets.length ? `<optgroup label="Мои">${settings.historyPicPresets.map(opt).join('')}</optgroup>` : ''}
            </select>
        </label>
        <div class="iig-hp-dialog-row">
            <label>Промпт пишет
                <select id="iig_hpd_llm" class="text_pole">
                    <option value="chat" ${settings.historyPicLlm !== 'vision' ? 'selected' : ''}>Модель чата</option>
                    <option value="vision" ${settings.historyPicLlm === 'vision' ? 'selected' : ''}>Vision API</option>
                </select>
            </label>
            <label title="Сколько сообщений истории брать максимум (с прошлой иллюстрации сцены, но не больше)">Сообщений
                <input type="number" id="iig_hpd_max" class="text_pole" min="2" max="100" step="1" value="${Math.max(2, Math.min(100, parseInt(settings.historyPicMaxMessages, 10) || 20))}">
            </label>
        </div>
        <label class="checkbox_label" title="LLM допишет короткую строку-эпиграф — она встанет цитатой над картинкой">
            <input type="checkbox" id="iig_hpd_quote" ${settings.historyPicQuote !== false ? 'checked' : ''}>
            <span>Цитата-эпиграф над картинкой</span>
        </label>
        <label class="checkbox_label" title="Сообщение с иллюстрацией видно в чате, но модель его не получает в следующих генерациях">
            <input type="checkbox" id="iig_hpd_hide" ${settings.historyPicHideFromContext !== false ? 'checked' : ''}>
            <span>Не отправлять в контекст</span>
        </label>
    `;
    const result = await context.callGenericPopup(wrap, context.POPUP_TYPE.CONFIRM, '', { okButton: 'Создать', cancelButton: 'Отмена' });
    const affirmative = context.POPUP_RESULT?.AFFIRMATIVE ?? 1;
    if (result !== affirmative && result !== true) return;
    settings.historyPicPresetId = wrap.querySelector('#iig_hpd_preset')?.value || settings.historyPicPresetId;
    settings.historyPicLlm = wrap.querySelector('#iig_hpd_llm')?.value === 'vision' ? 'vision' : 'chat';
    settings.historyPicMaxMessages = Math.max(2, Math.min(100, parseInt(wrap.querySelector('#iig_hpd_max')?.value, 10) || 20));
    settings.historyPicQuote = !!wrap.querySelector('#iig_hpd_quote')?.checked;
    settings.historyPicHideFromContext = !!wrap.querySelector('#iig_hpd_hide')?.checked;
    saveSettings();
    // Отражаем выбор в карточке настроек, чтобы попап и карточка не разъезжались.
    try { renderHistoryPicPresetUi(); } catch (_) {}
    const llmSel = document.getElementById('iig_historypic_llm'); if (llmSel) llmSel.value = settings.historyPicLlm;
    const maxEl = document.getElementById('iig_historypic_max'); if (maxEl) maxEl.value = settings.historyPicMaxMessages;
    const quoteEl = document.getElementById('iig_historypic_quote'); if (quoteEl) quoteEl.checked = settings.historyPicQuote;
    const hideEl = document.getElementById('iig_historypic_hide'); if (hideEl) hideEl.checked = settings.historyPicHideFromContext;
    await generateHistoryPicture();
}

function ensureHistoryPicWandButton() {
    const settings = getSettings();
    const show = settings.enabled !== false && settings.historyPicEnabled !== false;
    let item = document.getElementById('iig_historypic_wand');
    if (!show) { if (item) item.remove(); return; }
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return; // меню ещё не построено — повторим на APP_READY/CHAT_CHANGED
    if (!item) {
        item = document.createElement('div');
        item.id = 'iig_historypic_wand';
        item.className = 'list-group-item flex-container flexGap5';
        item.title = 'Картинка по последним событиям РП: откроется окошко с выбором образа и запуском';
        item.addEventListener('click', () => openHistoryPicDialog());
        item.innerHTML = '<div class="fa-solid fa-panorama extensionsMenuExtensionButton"></div><span>Иллюстрация сцены</span>';
        menu.appendChild(item);
    }
}

// Перерисовка UI «образов»: селектор, поля своего пресета, readonly у встроенных,
// textarea блока задачи. Вызывается после построения панели и после загрузки профиля.
function renderHistoryPicPresetUi() {
    const settings = getSettings();
    ensureHistoryPicPresets(settings);
    const sel = document.getElementById('iig_historypic_preset');
    if (!sel) return;
    const active = getActiveHistoryPicPreset(settings);
    const own = settings.historyPicPresets;
    const opt = (p) => `<option value="${sanitizeForHtml(p.id)}" ${p.id === active.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}${p.standalone ? ' (полный)' : ''}</option>`;
    sel.innerHTML = `<optgroup label="Встроенные">${HISTORYPIC_BUILTIN_PRESETS.map(opt).join('')}</optgroup>`
        + (own.length ? `<optgroup label="Мои">${own.map(opt).join('')}</optgroup>` : '');
    const builtin = isHistoryPicBuiltin(active.id);
    document.getElementById('iig_historypic_preset_custom')?.classList.toggle('iig-hidden', builtin);
    document.getElementById('iig_historypic_preset_del')?.classList.toggle('iig-hidden', builtin);
    const txt = document.getElementById('iig_historypic_preset_text');
    if (txt) {
        txt.value = active.text || '';
        txt.readOnly = builtin;
        txt.style.opacity = builtin ? '0.8' : '';
    }
    const hint = document.getElementById('iig_historypic_preset_hint');
    if (hint) {
        hint.innerHTML = builtin
            ? 'Встроенный образ — только чтение. Кнопка <i class="fa-solid fa-clone"></i> создаст твою редактируемую копию.'
            : 'Бриф «что рисуем» для LLM. С галкой «полный промпт» пресет заменяет ВЕСЬ запрос (блок задачи не подставляется); плейсхолдеры <code>{{history}}</code>/<code>{{char}}</code>/<code>{{user}}</code> работают, без <code>{{history}}</code> кусок РП допишется в конец.';
    }
    if (!builtin) {
        const nameEl = document.getElementById('iig_historypic_preset_name');
        if (nameEl) nameEl.value = active.name;
        const arEl = document.getElementById('iig_historypic_preset_ar');
        if (arEl) arEl.value = VALID_ASPECT_RATIOS.includes(active.aspectRatio) ? active.aspectRatio : '';
        const styleEl = document.getElementById('iig_historypic_preset_style');
        if (styleEl) styleEl.value = active.style || '';
        const saEl = document.getElementById('iig_historypic_preset_standalone');
        if (saEl) saEl.checked = !!active.standalone;
    }
    const taskArea = document.getElementById('iig_historypic_task');
    if (taskArea && document.activeElement !== taskArea) {
        taskArea.value = settings.historyPicTaskPrompt || DEFAULT_HISTORYPIC_TASK;
    }
}

function bindHistoryPicSettingsEvents() {
    const settings = getSettings();
    document.getElementById('iig_historypic_enabled')?.addEventListener('change', (e) => {
        settings.historyPicEnabled = e.target.checked;
        saveSettings();
        ensureHistoryPicWandButton();
    });
    document.getElementById('iig_historypic_llm')?.addEventListener('change', (e) => {
        settings.historyPicLlm = e.target.value === 'vision' ? 'vision' : 'chat';
        saveSettings();
    });
    document.getElementById('iig_historypic_max')?.addEventListener('change', (e) => {
        settings.historyPicMaxMessages = Math.max(2, Math.min(100, parseInt(e.target.value, 10) || 20));
        e.target.value = settings.historyPicMaxMessages;
        saveSettings();
    });
    document.getElementById('iig_historypic_quote')?.addEventListener('change', (e) => {
        settings.historyPicQuote = e.target.checked;
        saveSettings();
    });
    document.getElementById('iig_historypic_hide')?.addEventListener('change', (e) => {
        settings.historyPicHideFromContext = e.target.checked;
        saveSettings();
    });
    // ── Пресеты «образа» ──
    const makePresetId = () => `iig-hp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const activeUserPreset = () => {
        ensureHistoryPicPresets(settings);
        return settings.historyPicPresets.find(p => p.id === settings.historyPicPresetId) || null;
    };
    // Подпись пункта в селекторе без перестройки списка — чтобы не терять фокус ввода.
    const refreshOptionLabel = (preset) => {
        const sel = document.getElementById('iig_historypic_preset');
        const option = sel ? Array.from(sel.options).find(o => o.value === preset.id) : null;
        if (option) option.textContent = preset.name + (preset.standalone ? ' (полный)' : '');
    };
    document.getElementById('iig_historypic_preset')?.addEventListener('change', (e) => {
        settings.historyPicPresetId = e.target.value;
        saveSettings();
        renderHistoryPicPresetUi();
    });
    document.getElementById('iig_historypic_preset_new')?.addEventListener('click', () => {
        ensureHistoryPicPresets(settings);
        const preset = {
            id: makePresetId(),
            name: `Свой образ ${settings.historyPicPresets.length + 1}`,
            text: 'One single image of ... — describe the format, composition, camera, light and mood. The LLM reads the story fragment and follows this brief.',
            aspectRatio: '', style: '', standalone: false,
        };
        settings.historyPicPresets.push(preset);
        settings.historyPicPresetId = preset.id;
        saveSettings();
        renderHistoryPicPresetUi();
    });
    document.getElementById('iig_historypic_preset_copy')?.addEventListener('click', () => {
        const src = getActiveHistoryPicPreset(settings);
        const preset = {
            id: makePresetId(),
            name: `${src.name} (копия)`,
            text: src.text || '', aspectRatio: src.aspectRatio || '', style: src.style || '',
            standalone: !!src.standalone,
        };
        settings.historyPicPresets.push(preset);
        settings.historyPicPresetId = preset.id;
        saveSettings();
        renderHistoryPicPresetUi();
        toastr.info(`Копия «${preset.name}» создана — редактируй`, 'Иллюстрация сцены', { timeOut: 2500 });
    });
    document.getElementById('iig_historypic_preset_del')?.addEventListener('click', () => {
        const preset = activeUserPreset();
        if (!preset) return; // встроенные не удаляются (кнопка и так скрыта)
        if (!confirm(`Удалить образ «${preset.name}»?`)) return;
        settings.historyPicPresets = settings.historyPicPresets.filter(p => p.id !== preset.id);
        settings.historyPicPresetId = HISTORYPIC_BUILTIN_PRESETS[0].id;
        saveSettings();
        renderHistoryPicPresetUi();
    });
    document.getElementById('iig_historypic_preset_name')?.addEventListener('input', (e) => {
        const preset = activeUserPreset();
        if (!preset) return;
        preset.name = String(e.target.value || '').trim() || preset.name;
        refreshOptionLabel(preset);
        saveSettings();
    });
    document.getElementById('iig_historypic_preset_ar')?.addEventListener('change', (e) => {
        const preset = activeUserPreset();
        if (!preset) return;
        preset.aspectRatio = e.target.value || '';
        saveSettings();
    });
    document.getElementById('iig_historypic_preset_style')?.addEventListener('input', (e) => {
        const preset = activeUserPreset();
        if (!preset) return;
        preset.style = String(e.target.value || '');
        saveSettings();
    });
    document.getElementById('iig_historypic_preset_standalone')?.addEventListener('change', (e) => {
        const preset = activeUserPreset();
        if (!preset) return;
        preset.standalone = e.target.checked;
        refreshOptionLabel(preset);
        saveSettings();
    });
    document.getElementById('iig_historypic_preset_text')?.addEventListener('input', (e) => {
        const preset = activeUserPreset();
        if (!preset) return; // встроенный readonly — input сюда не прилетит
        preset.text = e.target.value;
        saveSettings();
    });
    // ── Блок задачи (общий) ──
    document.getElementById('iig_historypic_task_toggle')?.addEventListener('click', () => {
        const wrap = document.getElementById('iig_historypic_task_wrap');
        const chev = document.getElementById('iig_historypic_task_chevron');
        if (!wrap) return;
        const hidden = wrap.classList.toggle('iig-hidden');
        if (chev) chev.className = `fa-solid fa-chevron-${hidden ? 'right' : 'down'} iig-card-chevron`;
    });
    const taskArea = document.getElementById('iig_historypic_task');
    taskArea?.addEventListener('input', () => {
        const v = taskArea.value;
        // Совпадение с дефолтом (или пусто) храним как '' → значит «использовать стандартный».
        settings.historyPicTaskPrompt = (v.trim() && v.trim() !== DEFAULT_HISTORYPIC_TASK.trim()) ? v : '';
        saveSettings();
    });
    document.getElementById('iig_historypic_task_reset')?.addEventListener('click', () => {
        settings.historyPicTaskPrompt = '';
        saveSettings();
        if (taskArea) taskArea.value = DEFAULT_HISTORYPIC_TASK;
        toastr.info('Блок задачи сброшен на стандартный', 'Иллюстрация сцены', { timeOut: 2000 });
    });
}

/**
 * Get a reference object by slot key.
 */
function getRefByKey(key, settings) {
    if (key === 'charRef') return settings.charRef;
    if (key === 'userRef') return settings.userRef;
    const match = key.match(/^npc_(\d+)$/);
    if (match) {
        const idx = parseInt(match[1], 10);
        if (!Array.isArray(settings.npcReferences)) settings.npcReferences = [];
        while (settings.npcReferences.length <= idx) {
            settings.npcReferences.push({ name: '', imageBase64: '', imagePath: '' });
        }
        return settings.npcReferences[idx];
    }
    return { name: '', imageBase64: '', imagePath: '' };
}

// ════════════════════════════════════════════
//  Глобальные профили (именованные снимки настроек)
// ════════════════════════════════════════════

// Реестр секций. Каждая секция = группа ключей settings, которую можно
// положить в профиль галкой. `secret` — ключи, вырезаемые при экспорте.
// `images` — секция тянет картинки (base64/пути), профиль может быть тяжёлым.
// Гардероб (отдельный extensionSettings-ключ) пока НЕ включён — кросс-модульно.
// Секции бывают двух родов:
//  • snapshot (keys[]) — профиль хранит копию значений настроек, загрузка их перезаписывает.
//  • activation (mode:'activation') — профиль хранит ССЫЛКИ на активные элементы общей
//    библиотеки (id аватаров, имена NPC, id лорбуков). Загрузка лишь переключает флаги
//    active/enabled, ничего не копируя и не удаляя. note — подсказка для тултипа чеклиста.
const PROFILE_SECTIONS = [
    { id: 'connection',    label: 'Подключение',              keys: ['apiType', 'endpoint', 'apiKey', 'model', 'customRequestFormat', 'customFullUrl', 'showAllModels'], secret: ['apiKey'] },
    { id: 'generation',    label: 'Параметры генерации',      keys: ['size', 'quality', 'aspectRatio', 'imageSize', 'maxRetries', 'retryDelay', 'naisteraModel', 'naisteraAspectRatio', 'naisteraVideoTest', 'naisteraVideoEveryN', 'electronhubStyle', 'electronhubNegativePrompt', 'electronhubGuidanceScale', 'electronhubSteps', 'electronhubEnableReferences', 'imgActionFullscreen', 'imgActionDownload', 'imgActionRegen'] },
    { id: 'imageContext',  label: 'Контекст изображений',     keys: ['imageContextEnabled', 'imageContextCount'] },
    { id: 'avatars',       label: 'Активные авы (char/user)',  mode: 'activation', note: 'какой аватар активен для {{char}} и {{user}}' },
    { id: 'autoAvatar',    label: 'Аватары: отправка/инъекция', keys: ['sendCharAvatar', 'sendUserAvatar', 'userAvatarFile', 'injectAvatarAppearanceToGeneration', 'injectAvatarAppearanceToChatEnabled', 'avatarAppearanceInjectionDepth'] },
    { id: 'npc',           label: 'Активные NPC',             mode: 'activation', note: 'какие NPC включены (по имени)' },
    { id: 'lorebooks',     label: 'Активные лорбуки',          mode: 'activation', note: 'какие лорбуки включены + активный' },
    { id: 'descriptions',  label: 'Описания {{char}}/{{user}}', keys: ['charDescription', 'userDescription', 'injectDescriptions'] },
    { id: 'styles',        label: 'Стили',                    keys: ['styles', 'activeStyleId'] },
    { id: 'vision',        label: 'Vision',                   keys: ['visionEndpoint', 'visionApiKey', 'visionModel', 'visionPrompt'], secret: ['visionApiKey'] },
    { id: 'historyPic',    label: 'Иллюстрация сцены',        keys: ['historyPicEnabled', 'historyPicLlm', 'historyPicMaxMessages', 'historyPicTaskPrompt', 'historyPicPresets', 'historyPicPresetId', 'historyPicQuote', 'historyPicHideFromContext', 'historyPicPrompt'] },
    { id: 'flags',         label: 'Общие флаги',              keys: ['enabled', 'externalBlocks'] },
];
const PROFILE_SECTION_BY_ID = Object.fromEntries(PROFILE_SECTIONS.map(s => [s.id, s]));

function makeProfileId() {
    return 'iig-prof-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Нормализованный объект scope {sectionId: bool} из settings.profileSaveScope.
function getProfileSaveScope(settings = getSettings()) {
    const raw = settings.profileSaveScope && typeof settings.profileSaveScope === 'object' ? settings.profileSaveScope : {};
    const out = {};
    for (const s of PROFILE_SECTIONS) out[s.id] = raw[s.id] === true;
    return out;
}

// Снимок секции-активации: только ССЫЛКИ на активные элементы (не копии данных).
function snapshotActivationSection(sectionId, settings) {
    if (sectionId === 'avatars') {
        return { activeChar: settings.activeAvatarChar ?? null, activeUser: settings.activeAvatarUser ?? null };
    }
    if (sectionId === 'npc') {
        const names = (Array.isArray(settings.npcReferences) ? settings.npcReferences : [])
            .filter(n => n && n.enabled !== false && String(n.name || '').trim())
            .map(n => String(n.name).trim());
        return { enabledNames: names };
    }
    if (sectionId === 'lorebooks') {
        const ids = (Array.isArray(settings.lorebooks) ? settings.lorebooks : [])
            .filter(l => l && l.enabled !== false)
            .map(l => l.id);
        return { enabledIds: ids, activeId: settings.activeLorebookId || '', sendRefDescriptions: settings.sendRefDescriptions !== false };
    }
    return {};
}

// Применяет секцию-активацию: переключает флаги active/enabled общей библиотеки (ничего не удаляя).
function applyActivationSection(sectionId, bucket, settings) {
    if (!bucket || typeof bucket !== 'object') return;
    if (sectionId === 'avatars') {
        const items = Array.isArray(settings.avatarItems) ? settings.avatarItems : [];
        const exists = id => id && items.some(a => a.id === id);
        settings.activeAvatarChar = exists(bucket.activeChar) ? bucket.activeChar : null;
        settings.activeAvatarUser = exists(bucket.activeUser) ? bucket.activeUser : null;
        return;
    }
    if (sectionId === 'npc') {
        const set = new Set((bucket.enabledNames || []).map(s => String(s).trim()));
        for (const n of (Array.isArray(settings.npcReferences) ? settings.npcReferences : [])) {
            if (n) n.enabled = set.has(String(n.name || '').trim());
        }
        return;
    }
    if (sectionId === 'lorebooks') {
        const set = new Set(bucket.enabledIds || []);
        const lbs = Array.isArray(settings.lorebooks) ? settings.lorebooks : [];
        for (const l of lbs) { if (l) l.enabled = set.has(l.id); }
        if (bucket.activeId && lbs.some(l => l.id === bucket.activeId)) settings.activeLorebookId = bucket.activeId;
        if (typeof bucket.sendRefDescriptions === 'boolean') settings.sendRefDescriptions = bucket.sendRefDescriptions;
        return;
    }
}

// Снимок текущих настроек по выбранным секциям → { sections:[ids], data:{id:{...}} }.
function snapshotProfileSections(scope, settings = getSettings()) {
    const sections = [];
    const data = {};
    for (const section of PROFILE_SECTIONS) {
        if (!scope[section.id]) continue;
        sections.push(section.id);
        if (section.mode === 'activation') {
            data[section.id] = snapshotActivationSection(section.id, settings);
        } else {
            const bucket = {};
            for (const key of section.keys) bucket[key] = structuredClone(settings[key]);
            data[section.id] = bucket;
        }
    }
    return { sections, data };
}

// Применяет данные профиля в settings (только присутствующие секции). Возвращает список применённых id.
function applyProfileToSettings(profile, settings = getSettings()) {
    if (!profile || !profile.data) return [];
    const applied = [];
    for (const sectionId of (profile.sections || [])) {
        const section = PROFILE_SECTION_BY_ID[sectionId];
        const bucket = profile.data[sectionId];
        if (!section || !bucket || typeof bucket !== 'object') continue;
        if (section.mode === 'activation') {
            applyActivationSection(sectionId, bucket, settings);
        } else {
            for (const key of section.keys) {
                if (Object.hasOwn(bucket, key)) settings[key] = structuredClone(bucket[key]);
            }
        }
        applied.push(sectionId);
    }
    return applied;
}

function profileCreate(name, scope, settings = getSettings()) {
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    const snap = snapshotProfileSections(scope, settings);
    const profile = {
        id: makeProfileId(),
        name: String(name || '').trim() || `Профиль ${settings.profiles.length + 1}`,
        createdAt: Date.now(),
        sections: snap.sections,
        data: snap.data,
    };
    settings.profiles.push(profile);
    settings.activeProfileId = profile.id;
    return profile;
}

// JSON для экспорта. stripSecrets (default true) обнуляет секретные ключи (apiKey/visionApiKey).
function buildProfileExportJson(profile, { stripSecrets = true } = {}) {
    const data = structuredClone(profile.data || {});
    if (stripSecrets) {
        for (const section of PROFILE_SECTIONS) {
            if (!section.secret || !data[section.id]) continue;
            for (const k of section.secret) if (Object.hasOwn(data[section.id], k)) data[section.id][k] = '';
        }
    }
    return {
        kind: 'iig-profile',
        version: 1,
        name: String(profile.name || 'Профиль'),
        sections: [...(profile.sections || [])],
        data,
    };
}

function parseProfileJson(rawText) {
    let payload;
    try { payload = JSON.parse(String(rawText || '')); } catch (e) {
        throw new Error(`Невалидный JSON: ${e.message}`);
    }
    if (!payload || typeof payload !== 'object') throw new Error('Невалидный профиль');
    if (payload.kind !== 'iig-profile') throw new Error('Поле "kind" должно быть "iig-profile"');
    if (payload.version !== 1) throw new Error(`Неподдерживаемая версия: ${payload.version}`);
    const sections = Array.isArray(payload.sections) ? payload.sections.filter(id => PROFILE_SECTION_BY_ID[id]) : [];
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    return { kind: 'iig-profile', version: 1, name: String(payload.name || 'Импортированный профиль'), sections, data };
}

function profileImportFromPayload(payload, settings = getSettings()) {
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    // оставляем только ключи известных секций
    const cleanData = {};
    const cleanSections = [];
    for (const id of payload.sections) {
        const section = PROFILE_SECTION_BY_ID[id];
        if (!section) continue;
        const bucket = payload.data[id] || {};
        if (section.mode === 'activation') {
            // Структуру активации не фильтруем по keys — applyActivationSection её валидирует.
            cleanData[id] = structuredClone(bucket);
        } else {
            const clean = {};
            for (const key of section.keys) if (Object.hasOwn(bucket, key)) clean[key] = bucket[key];
            cleanData[id] = clean;
        }
        cleanSections.push(id);
    }
    const profile = {
        id: makeProfileId(),
        name: payload.name,
        createdAt: Date.now(),
        sections: cleanSections,
        data: cleanData,
    };
    settings.profiles.push(profile);
    settings.activeProfileId = profile.id;
    return profile;
}

// HTML карточки «Профили» (вставляется в начало панели настроек).
function buildProfileCardHtml(settings = getSettings()) {
    const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
    const scope = getProfileSaveScope(settings);
    const optionsHtml = `<option value="">-- Выберите профиль --</option>` + profiles.map(p =>
        `<option value="${sanitizeForHtml(p.id)}" ${settings.activeProfileId === p.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`
    ).join('');
    const scopeHtml = PROFILE_SECTIONS.map(s =>
        `<label class="checkbox_label" title="${sanitizeForHtml(s.note || (s.keys || []).join(', '))}">
            <input type="checkbox" class="iig-profile-scope-cb" data-section="${s.id}" ${scope[s.id] ? 'checked' : ''}>
            <span>${sanitizeForHtml(s.label)}</span>
        </label>`
    ).join('');
    return `
        <div class="iig-settings-card iig-profile-card iig-collapse-card">
            <h4 class="iig-card-toggle ${settings.profilesOpen ? '' : 'iig-card-collapsed'}" id="iig_profile_toggle" title="Свернуть/развернуть">
                <i class="fa-solid fa-chevron-${settings.profilesOpen ? 'down' : 'right'} iig-card-chevron"></i>
                <span><i class="fa-solid fa-layer-group"></i> Профили</span>
                <span class="iig-card-count" id="iig_profile_count">${profiles.length || ''}</span>
            </h4>
            <div class="iig-card-body ${settings.profilesOpen ? '' : 'iig-hidden'}" id="iig_profile_body">
                <div class="iig-profile-bar">
                    <select id="iig_profile_select" class="text_pole flex1">${optionsHtml}</select>
                    <div id="iig_profile_load" class="menu_button" title="Загрузить выбранный профиль"><i class="fa-solid fa-download"></i></div>
                    <div id="iig_profile_save" class="menu_button" title="Сохранить текущие настройки как новый профиль"><i class="fa-solid fa-floppy-disk"></i></div>
                    <div id="iig_profile_update" class="menu_button" title="Обновить выбранный профиль текущими настройками"><i class="fa-solid fa-pen-to-square"></i></div>
                    <div id="iig_profile_export" class="menu_button" title="Экспорт профиля в файл (ключи вырезаются)"><i class="fa-solid fa-file-export"></i></div>
                    <div id="iig_profile_import" class="menu_button" title="Импорт профиля из файла"><i class="fa-solid fa-file-import"></i></div>
                    <div id="iig_profile_delete" class="menu_button" title="Удалить выбранный профиль" style="color:#cc5555;"><i class="fa-solid fa-trash"></i></div>
                </div>
                <div class="iig-profile-scope">
                    <span class="hint">Что сохранять в профиль:</span>
                    <div class="iig-profile-scope-grid">${scopeHtml}</div>
                </div>
            </div>
        </div>
    `;
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

                    ${buildProfileCardHtml(settings)}

                    <div class="iig-settings-card iig-collapse-card">
                        <h4 class="iig-card-toggle ${settings.apiOpen ? '' : 'iig-card-collapsed'}" id="iig_api_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.apiOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Настройки API</span>
                        </h4>
                        <div class="iig-card-body ${settings.apiOpen ? '' : 'iig-hidden'}" id="iig_api_body">
                    
                    <!-- Тип эндпоинта -->
                    <div class="flex-row">
                        <label for="iig_api_type">Тип API</label>
                        <select id="iig_api_type" class="flex1">
                            <option value="openai" ${settings.apiType === 'openai' ? 'selected' : ''}>OpenAI-совместимый (/v1/images/generations)</option>
                            <option value="void" ${settings.apiType === 'void' ? 'selected' : ''}>VoidAI / RouteMyAI (chat-completions)</option>
                            <option value="gemini" ${settings.apiType === 'gemini' ? 'selected' : ''}>Gemini-совместимый (nano-banana)</option>
                            <option value="naistera" ${settings.apiType === 'naistera' ? 'selected' : ''}>Naistera (naistera.org)</option>
                            <option value="electronhub" ${settings.apiType === 'electronhub' ? 'selected' : ''}>Electron Hub (200+ моделей)</option>
                            <option value="custom" ${settings.apiType === 'custom' ? 'selected' : ''}>Custom (свой URL + формат)</option>
                        </select>
                    </div>

                    <!-- Custom format selector — only when apiType=custom -->
                    <div class="flex-row ${settings.apiType === 'custom' ? '' : 'iig-hidden'}" id="iig_custom_format_row">
                        <label for="iig_custom_request_format">Формат запроса</label>
                        <select id="iig_custom_request_format" class="flex1">
                            <option value="openai" ${settings.customRequestFormat === 'openai' ? 'selected' : ''}>OpenAI (/v1/images/generations)</option>
                            <option value="void" ${settings.customRequestFormat === 'void' ? 'selected' : ''}>Void / chat-completions</option>
                            <option value="gemini" ${settings.customRequestFormat === 'gemini' ? 'selected' : ''}>Gemini (generateContent)</option>
                            <option value="naistera" ${settings.customRequestFormat === 'naistera' ? 'selected' : ''}>Naistera (/api/generate)</option>
                            <option value="electronhub" ${settings.customRequestFormat === 'electronhub' ? 'selected' : ''}>Electron Hub (расширенный OpenAI)</option>
                        </select>
                    </div>
                    <div class="flex-row ${settings.apiType === 'custom' ? '' : 'iig-hidden'}" id="iig_custom_full_url_row">
                        <label for="iig_custom_full_url">Полный URL (опц.)</label>
                        <input type="text" id="iig_custom_full_url" class="text_pole flex1"
                               value="${sanitizeForHtml(settings.customFullUrl || '')}"
                               placeholder="https://api.example.com/v1/images/generations (если задан, используется как есть)">
                    </div>

                    <!-- URL эндпоинта -->
                    <div class="flex-row">
                        <label for="iig_endpoint">URL эндпоинта</label>
                        <input type="text" id="iig_endpoint" class="text_pole flex1"
                               value="${settings.endpoint}"
                               placeholder="https://api.example.com">
                    </div>
                    <div class="iig-presets-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
                        <span style="font-size:0.85em;opacity:0.8;">Пресеты подключения:</span>
                        <select id="iig_preset_select" class="text_pole flex1" style="min-width:140px;">
                            <option value="">-- Выберите пресет --</option>
                            ${(settings.connectionPresets || []).map(p => `<option value="${sanitizeForHtml(p.id)}" ${settings.activePresetId === p.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`).join('')}
                        </select>
                        <div id="iig_preset_load" class="menu_button" title="Загрузить выбранный пресет" style="font-size:0.85em;padding:3px 10px;"><i class="fa-solid fa-download"></i></div>
                        <div id="iig_preset_save" class="menu_button" title="Сохранить текущие настройки как пресет" style="font-size:0.85em;padding:3px 10px;"><i class="fa-solid fa-floppy-disk"></i></div>
                        <div id="iig_preset_update" class="menu_button" title="Обновить выбранный пресет текущими настройками" style="font-size:0.85em;padding:3px 10px;"><i class="fa-solid fa-pen-to-square"></i></div>
                        <div id="iig_preset_delete" class="menu_button" title="Удалить выбранный пресет" style="font-size:0.85em;padding:3px 10px;color:#cc5555;"><i class="fa-solid fa-trash"></i></div>
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
                    <div class="${settings.apiType === 'naistera' ? 'iig-hidden' : ''}" id="iig_show_all_models_row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_show_all_models" ${settings.showAllModels ? 'checked' : ''}>
                            <span>Показывать все модели (без фильтра image-моделей)</span>
                        </label>
                        <p class="hint" style="margin-left:24px;">Включи если нужная картиночная модель не появляется в списке (например, малоизвестные модели VoidAI/Custom-эндпоинтов).</p>
                    </div>
                        </div>
                    </div>

                    <div class="iig-settings-card iig-collapse-card" id="iig_image_context_section">
                        <h4 class="iig-card-toggle ${settings.imageContextOpen ? '' : 'iig-card-collapsed'}" id="iig_image_context_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.imageContextOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Контекст картинок</span>
                        </h4>
                        <div class="iig-card-body ${settings.imageContextOpen ? '' : 'iig-hidden'}" id="iig_image_context_body">
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
                    </div>

                    <div class="iig-settings-card iig-collapse-card">
                        <h4 class="iig-card-toggle ${settings.genParamsOpen ? '' : 'iig-card-collapsed'}" id="iig_genparams_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.genParamsOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Параметры генерации</span>
                        </h4>
                        <div class="iig-card-body ${settings.genParamsOpen ? '' : 'iig-hidden'}" id="iig_genparams_body">

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
                                <option value="grok-pro" ${normalizeNaisteraModel(settings.naisteraModel) === 'grok-pro' ? 'selected' : ''}>grok-pro</option>
                                <option value="nano banana" ${normalizeNaisteraModel(settings.naisteraModel) === 'nano banana' ? 'selected' : ''}>nano banana</option>
                                <option value="nano banana 2" ${normalizeNaisteraModel(settings.naisteraModel) === 'nano banana 2' ? 'selected' : ''}>nano banana 2</option>
                                <option value="novelai" ${normalizeNaisteraModel(settings.naisteraModel) === 'novelai' ? 'selected' : ''}>novelai</option>
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

                        <div id="iig_avatar_section" class="iig-settings-card-nested ${settings.apiType === 'gemini' ? '' : 'hidden'}">
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

                        <div class="flex-row" style="margin-top:6px;">
                            <label title="Какие кнопки показывать в углу сгенерированной картинки в чате. У картинок-ошибок кнопка перегенерации остаётся всегда. Скачивание также доступно во вьюере по тапу на картинку.">Кнопки на картинке</label>
                        </div>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_imgbtn_fullscreen" ${settings.imgActionFullscreen !== false ? 'checked' : ''}>
                            <span>На весь экран</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_imgbtn_download" ${settings.imgActionDownload === true ? 'checked' : ''}>
                            <span>Скачать оригинал</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_imgbtn_regen" ${settings.imgActionRegen !== false ? 'checked' : ''}>
                            <span>Перегенерировать</span>
                        </label>
                        </div>
                    </div>

                    <div class="iig-settings-card iig-collapse-card">
                        <h4 class="iig-card-toggle ${settings.stylesOpen ? '' : 'iig-card-collapsed'}" id="iig_styles_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.stylesOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Стили</span>
                            <span class="iig-card-count" id="iig_styles_count"></span>
                        </h4>
                        <div class="iig-card-body ${settings.stylesOpen ? '' : 'iig-hidden'}" id="iig_styles_body">
                            <div class="iig-style-toolbar">
                                <input type="text" id="iig_new_style_name" class="text_pole flex1" placeholder="Название нового стиля">
                                <div id="iig_style_add" class="menu_button" title="Создать стиль"><i class="fa-solid fa-plus"></i></div>
                                <div id="iig_style_pick_site" class="menu_button" title="Выбрать стиль с сайта"><i class="fa-solid fa-palette"></i> Сайт</div>
                            </div>
                            <div id="iig_style_presets" class="iig-style-presets"></div>
                            <div id="iig_style_editor"></div>
                        </div>
                    </div>

                    <div class="iig-settings-card iig-collapse-card" id="iig_refs_mega_section">
                        <h4 class="iig-card-toggle ${settings.refsOpen ? '' : 'iig-card-collapsed'}" id="iig_refs_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.refsOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Референсы</span>
                        </h4>
                        <div class="iig-card-body ${settings.refsOpen ? '' : 'iig-hidden'}" id="iig_refs_body">

                        <!-- Tabs -->
                        <div class="iig-ref-tabs">
                            <div class="iig-ref-tab iig-ref-tab-active" data-tab="avatars" title="Аватары"><i class="fa-solid fa-user-circle"></i><span>Аватары</span></div>
                            <div class="iig-ref-tab" data-tab="npc" title="NPC"><i class="fa-solid fa-users"></i><span>NPC</span></div>
                            <div class="iig-ref-tab" data-tab="lorebook" title="Лорбуки"><i class="fa-solid fa-book"></i><span>Лорбуки</span></div>
                            <div class="iig-ref-tab" data-tab="wardrobe" title="Гардероб"><i class="fa-solid fa-shirt"></i><span>Гардероб</span></div>
                            <div class="iig-ref-tab" data-tab="vision" title="Vision"><i class="fa-solid fa-eye"></i><span>Vision</span></div>
                        </div>

                        <!-- ═══ Tab: Аватары ═══ -->
                        <div class="iig-ref-tab-content iig-ref-tab-content-active" data-tab-content="avatars" id="iig_refs_section">
                            <div id="iig_ref_slots"></div>
                        </div>

                        <!-- ═══ Tab: NPC ═══ -->
                        <div class="iig-ref-tab-content" data-tab-content="npc" id="iig_npc_tab_content">
                            <p class="hint" style="margin-bottom:6px;">NPC автоматически подбираются по имени в промпте генерации.</p>
                            <div id="iig_npc_slots"></div>
                        </div>

                        <!-- ═══ Tab: Лорбуки ═══ -->
                        <div class="iig-ref-tab-content" data-tab-content="lorebook" id="iig_lorebook_section">
                            <p class="hint" style="margin-bottom:6px;">Референсы с триггерами — regex, группы, приоритеты, вторичные ключи.</p>
                            <div class="iig-lorebook-toolbar">
                                <select id="iig_lorebook_select" class="text_pole flex1"></select>
                                <label class="checkbox_label iig-lorebook-enabled-label" title="Учитывать этот лорбук при совпадениях">
                                    <input type="checkbox" id="iig_lorebook_enabled"><span>Вкл</span>
                                </label>
                                <div id="iig_lorebook_add" class="menu_button" title="Создать лорбук"><i class="fa-solid fa-plus"></i></div>
                                <div id="iig_lorebook_rename" class="menu_button" title="Переименовать лорбук"><i class="fa-solid fa-pen"></i></div>
                                <div id="iig_lorebook_import_url" class="menu_button" title="Импорт лорбука по URL"><i class="fa-solid fa-link"></i></div>
                                <div id="iig_lorebook_import_file" class="menu_button" title="Импорт лорбука из файла"><i class="fa-solid fa-file-arrow-down"></i></div>
                                <div id="iig_lorebook_export" class="menu_button" title="Экспорт лорбука в JSON"><i class="fa-solid fa-file-arrow-up"></i></div>
                                <div id="iig_lorebook_delete" class="menu_button" title="Удалить лорбук" style="color:#cc5555;"><i class="fa-solid fa-trash"></i></div>
                            </div>
                            <div class="iig-lorebook-actions">
                                <div id="iig_lorebook_add_ref" class="menu_button"><i class="fa-solid fa-plus"></i> Добавить референс</div>
                                <div id="iig_lorebook_load_ref" class="menu_button" title="Загрузить референсы по URL (по одному на строку)"><i class="fa-solid fa-link"></i> Загрузить референс</div>
                            </div>
                            <p id="iig_lorebook_status" class="hint" style="margin:6px 0;"></p>
                            <div id="iig_lorebook_refs_list"></div>
                            <label class="checkbox_label iig-lorebook-send-desc" title="Добавлять текстовые описания совпавших референсов в промпт картинки">
                                <input type="checkbox" id="iig_lorebook_send_descriptions"><span>Отправлять описания референсов из лорбука</span>
                            </label>
                        </div>

                        <!-- ═══ Tab: Гардероб ═══ -->
                        <div class="iig-ref-tab-content" data-tab-content="wardrobe" id="iig_wardrobe_tab_content">
                            <p class="hint" style="margin-bottom:8px;">Активный аутфит отправляется как reference при генерации.</p>
                            <div class="flex-row">
                                <div id="sw_open_wardrobe" class="menu_button" style="width: 100%;">
                                    <i class="fa-solid fa-shirt"></i> Открыть гардероб
                                </div>
                            </div>
                            <div class="flex-row" style="margin-top:8px;align-items:center;">
                                <label for="sw_btn_placement" style="white-space:nowrap;">Кнопка гардероба</label>
                                <select id="sw_btn_placement" class="text_pole flex1">
                                    <option value="bar">В строке ввода</option>
                                    <option value="float">Плавающая в чате</option>
                                    <option value="wand">В «волшебной палочке»</option>
                                </select>
                            </div>
                            <div class="flex-row" style="margin-top:6px;">
                                <label for="sw_max_dim">Макс. размер (px)</label>
                                <input type="number" id="sw_max_dim" class="text_pole flex1" value="512" min="128" max="1024" step="64">
                            </div>
                        </div>

                        <!-- ═══ Tab: Vision ═══ -->
                        <div class="iig-ref-tab-content" data-tab-content="vision" id="iig_vision_section">
                            <p class="hint" style="margin-bottom:6px;">Vision-модель для авто-описаний: референсы, аватары, NPC и наряды гардероба. Эндпоинт/ключ не заданы — фолбэк на основные настройки. Модель не выбрана — гардероб описывает наряды через основную чат-модель ST.</p>
                            <div class="flex-row">
                                <label for="iig_vision_endpoint">Эндпоинт</label>
                                <input type="text" id="iig_vision_endpoint" class="text_pole flex1" placeholder="(основной эндпоинт)" value="${sanitizeForHtml(settings.visionEndpoint || '')}">
                            </div>
                            <div class="flex-row">
                                <label for="iig_vision_api_key">API ключ</label>
                                <input type="password" id="iig_vision_api_key" class="text_pole flex1" placeholder="(основной ключ)" value="${sanitizeForHtml(settings.visionApiKey || '')}">
                                <div id="iig_vision_key_toggle" class="menu_button iig-key-toggle" title="Показать/Скрыть"><i class="fa-solid fa-eye"></i></div>
                            </div>
                            <div class="flex-row">
                                <label for="iig_vision_model">Модель</label>
                                <select id="iig_vision_model" class="flex1">
                                    ${settings.visionModel ? `<option value="${sanitizeForHtml(settings.visionModel)}" selected>${sanitizeForHtml(settings.visionModel)}</option>` : '<option value="">-- Выберите --</option>'}
                                </select>
                                <div id="iig_vision_refresh_models" class="menu_button iig-refresh-btn" title="Обновить"><i class="fa-solid fa-sync"></i></div>
                            </div>
                            <div class="flex-row" style="flex-direction:column;align-items:stretch;">
                                <label for="iig_vision_prompt" title="Используется для описания нарядов в гардеробе. У референсов, аватаров и NPC — свои специализированные промпты.">Промпт</label>
                                <textarea id="iig_vision_prompt" class="text_pole" rows="2" placeholder="(дефолт: описание одежды/наряда на картинке)">${sanitizeForHtml(settings.visionPrompt || '')}</textarea>
                            </div>
                        </div>
                        </div>
                    </div>

                    <div class="iig-settings-card iig-collapse-card" id="iig_historypic_section">
                        <h4 class="iig-card-toggle ${settings.historyPicOpen ? '' : 'iig-card-collapsed'}" id="iig_historypic_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.historyPicOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Иллюстрация сцены</span>
                        </h4>
                        <div class="iig-card-body ${settings.historyPicOpen ? '' : 'iig-hidden'}" id="iig_historypic_body">
                        <p class="hint">Кнопка «Иллюстрация сцены» в меню «волшебной палочки»: вспомогательная LLM читает последние события РП (с прошлой иллюстрации сцены, но не больше лимита) и пишет промпт по выбранному «образу», дальше картинка генерится как обычно — с референсами и кнопкой перегенерации.</p>
                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_historypic_enabled" ${settings.historyPicEnabled !== false ? 'checked' : ''}>
                            <span>Кнопка в «волшебной палочке»</span>
                        </label>
                        <div class="flex-row">
                            <label for="iig_historypic_llm">Промпт пишет</label>
                            <select id="iig_historypic_llm" class="text_pole flex1">
                                <option value="chat" ${settings.historyPicLlm !== 'vision' ? 'selected' : ''}>Основная модель чата</option>
                                <option value="vision" ${settings.historyPicLlm === 'vision' ? 'selected' : ''}>Vision API (таб Vision)</option>
                            </select>
                        </div>
                        <div class="flex-row">
                            <label for="iig_historypic_max" title="Сколько сообщений истории брать максимум. Берутся сообщения после прошлой иллюстрации сцены (обычные картинки в постах не считаются), но не больше этого числа.">Макс. сообщений</label>
                            <input type="number" id="iig_historypic_max" class="text_pole flex1" min="2" max="100" step="1" value="${Math.max(2, Math.min(100, parseInt(settings.historyPicMaxMessages, 10) || 20))}">
                        </div>
                        <label class="checkbox_label" title="LLM допишет короткую строку-эпиграф — она встанет цитатой над картинкой.">
                            <input type="checkbox" id="iig_historypic_quote" ${settings.historyPicQuote !== false ? 'checked' : ''}>
                            <span>Цитата-эпиграф над картинкой</span>
                        </label>
                        <label class="checkbox_label" title="Сообщение с иллюстрацией видно в чате, но скрыто из промпта (is_system) — модель его не видит в следующих генерациях.">
                            <input type="checkbox" id="iig_historypic_hide" ${settings.historyPicHideFromContext !== false ? 'checked' : ''}>
                            <span>Не отправлять в контекст</span>
                        </label>
                        <div class="flex-row" style="grid-template-columns:1fr auto auto auto;align-items:center;">
                            <label for="iig_historypic_preset">Образ (что рисуем)</label>
                            <div id="iig_historypic_preset_new" class="menu_button" title="Создать свой образ" style="font-size:0.85em;padding:2px 8px;"><i class="fa-solid fa-plus"></i></div>
                            <div id="iig_historypic_preset_copy" class="menu_button" title="Дублировать выбранный образ в свой (редактируемый)" style="font-size:0.85em;padding:2px 8px;"><i class="fa-solid fa-clone"></i></div>
                            <div id="iig_historypic_preset_del" class="menu_button iig-hidden" title="Удалить свой образ" style="font-size:0.85em;padding:2px 8px;"><i class="fa-solid fa-trash-can"></i></div>
                        </div>
                        <select id="iig_historypic_preset" class="text_pole" style="width:100%;box-sizing:border-box;"></select>
                        <div id="iig_historypic_preset_custom" class="iig-hidden">
                            <div class="flex-row">
                                <label for="iig_historypic_preset_name">Название</label>
                                <input type="text" id="iig_historypic_preset_name" class="text_pole flex1">
                            </div>
                            <div class="flex-row">
                                <label for="iig_historypic_preset_ar" title="Соотношение сторон картинки для этого образа. Пусто — берётся из общих параметров генерации.">Соотношение</label>
                                <select id="iig_historypic_preset_ar" class="text_pole flex1">
                                    <option value="">Из настроек</option>
                                    ${VALID_ASPECT_RATIOS.map(ar => `<option value="${ar}">${ar}</option>`).join('')}
                                </select>
                            </div>
                            <div class="flex-row">
                                <label for="iig_historypic_preset_style" title="Хвост стиля — уходит в тег картинки. Активный «Стиль» из секции Стили его перекрывает.">Стиль</label>
                                <input type="text" id="iig_historypic_preset_style" class="text_pole flex1" placeholder="cinematic film still, film grain…">
                            </div>
                            <label class="checkbox_label" title="Текст пресета — это ВЕСЬ промпт для LLM, блок задачи не подставляется. Для переноса старых полных промптов.">
                                <input type="checkbox" id="iig_historypic_preset_standalone">
                                <span>Полный промпт (без блока задачи)</span>
                            </label>
                        </div>
                        <textarea id="iig_historypic_preset_text" class="text_pole" rows="7" style="width:100%;box-sizing:border-box;"></textarea>
                        <p class="hint" id="iig_historypic_preset_hint"></p>
                        <div class="flex-row" style="grid-template-columns:1fr auto;">
                            <label id="iig_historypic_task_toggle" style="cursor:pointer;" title="Общий блок: объясняет LLM её работу и железные правила промпта"><i class="fa-solid fa-chevron-right iig-card-chevron" id="iig_historypic_task_chevron"></i> Блок задачи (общий)</label>
                            <div id="iig_historypic_task_reset" class="menu_button" title="Вернуть стандартный блок задачи" style="font-size:0.85em;padding:2px 8px;"><i class="fa-solid fa-rotate-left"></i> Сбросить</div>
                        </div>
                        <div id="iig_historypic_task_wrap" class="iig-hidden">
                            <textarea id="iig_historypic_task" class="text_pole" rows="8" style="width:100%;box-sizing:border-box;"></textarea>
                            <p class="hint">Учит LLM читать фрагмент и писать промпт. Плейсхолдеры: <code>{{history}}</code>, <code>{{char}}</code>, <code>{{user}}</code>; без <code>{{history}}</code> кусок РП допишется в конец. Для пресетов с галкой «полный промпт» этот блок не используется.</p>
                        </div>
                        </div>
                    </div>

                    <div class="iig-settings-card iig-collapse-card ${settings.apiType === 'electronhub' ? '' : 'iig-hidden'}" id="iig_electronhub_section">
                        <h4 class="iig-card-toggle ${settings.electronhubOpen ? '' : 'iig-card-collapsed'}" id="iig_electronhub_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.electronhubOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Electron Hub</span>
                        </h4>
                        <div class="iig-card-body ${settings.electronhubOpen ? '' : 'iig-hidden'}" id="iig_electronhub_body">
                        <p class="hint">Расширенные параметры специфичные для ElectronHub. Все поля опциональны — оставь пустыми, если не нужно.</p>

                        <div class="flex-row">
                            <label for="iig_electronhub_style">Стиль</label>
                            <input type="text" id="iig_electronhub_style" class="text_pole flex1" placeholder="photographic, anime, cinematic, digital-art..." value="${settings.electronhubStyle || ''}">
                        </div>

                        <div class="flex-row" style="flex-direction:column;align-items:stretch;">
                            <label for="iig_electronhub_negative">Negative prompt</label>
                            <textarea id="iig_electronhub_negative" class="text_pole" rows="2" placeholder="что НЕ хотим видеть на картинке (blurry, low quality, ...)">${settings.electronhubNegativePrompt || ''}</textarea>
                        </div>

                        <div class="flex-row">
                            <label for="iig_electronhub_guidance" title="Чем выше — тем точнее следует промпту, но менее креативно">CFG Scale</label>
                            <input type="number" id="iig_electronhub_guidance" class="text_pole flex1" min="1" max="20" step="0.5" placeholder="по умолчанию (обычно 7.0)" value="${settings.electronhubGuidanceScale || ''}">
                        </div>

                        <div class="flex-row">
                            <label for="iig_electronhub_steps" title="Больше шагов = качественнее, но медленнее">Steps</label>
                            <input type="number" id="iig_electronhub_steps" class="text_pole flex1" min="10" max="100" step="1" placeholder="по умолчанию (обычно 30)" value="${settings.electronhubSteps || ''}">
                        </div>

                        <label class="checkbox_label">
                            <input type="checkbox" id="iig_electronhub_refs" ${settings.electronhubEnableReferences ? 'checked' : ''}>
                            <span>Экспериментально: отправлять референсы</span>
                        </label>
                        <p class="hint" style="margin-left:24px;">Большинство моделей ElectronHub не поддерживают /v1/images/edits. Включай только если уверена что модель умеет принимать image на /v1/images/generations.</p>
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

                    <div class="iig-settings-card iig-collapse-card">
                        <h4 class="iig-card-toggle ${settings.debugOpen ? '' : 'iig-card-collapsed'}" id="iig_debug_toggle" title="Свернуть/развернуть">
                            <i class="fa-solid fa-chevron-${settings.debugOpen ? 'down' : 'right'} iig-card-chevron"></i>
                            <span>Ошибки и отладка</span>
                        </h4>
                        <div class="iig-card-body ${settings.debugOpen ? '' : 'iig-hidden'}" id="iig_debug_body">
                    
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
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <div id="iig_export_logs" class="menu_button" style="flex:1;">
                                <i class="fa-solid fa-download"></i> Экспорт логов
                            </div>
                            <div id="iig_show_last_gen" class="menu_button" style="flex:1;">
                                <i class="fa-solid fa-magnifying-glass"></i> Последняя генерация
                            </div>
                        </div>
                        </div>
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
// ── Style presets UI ──

function renderStylePresets() {
    const settings = getSettings();
    const styles = ensureStyles(settings);
    const activeId = settings.activeStyleId;

    const countEl = document.getElementById('iig_styles_count');
    if (countEl) countEl.textContent = styles.length ? `(${styles.length})` : '';

    const listEl = document.getElementById('iig_style_presets');
    if (listEl) {
        if (styles.length === 0) {
            listEl.innerHTML = '<p class="hint">Нет стилей. Создайте новый или выберите с сайта.</p>';
        } else {
            listEl.innerHTML = styles.map(s => `
                <div class="iig-style-chip ${s.id === activeId ? 'iig-style-chip-active' : ''}" data-style-id="${sanitizeForHtml(s.id)}">
                    <span class="iig-style-chip-name" data-style-activate="${sanitizeForHtml(s.id)}" title="${sanitizeForHtml(s.name)}">
                        <i class="fa-solid ${s.id === activeId ? 'fa-check' : 'fa-palette'}"></i><span class="iig-style-chip-label">${sanitizeForHtml(s.name)}</span>
                    </span>
                    <i class="fa-solid fa-xmark iig-style-chip-del" data-style-remove="${sanitizeForHtml(s.id)}" title="Удалить"></i>
                </div>
            `).join('');
        }
    }

    const editorEl = document.getElementById('iig_style_editor');
    if (editorEl) {
        const active = getActiveStylePreset(settings);
        if (!active) {
            editorEl.innerHTML = '';
        } else {
            editorEl.innerHTML = `
                <div class="iig-settings-card iig-style-editor-card">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                        <b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Активный: ${sanitizeForHtml(active.name)}</b>
                        <div id="iig_style_disable" class="menu_button" title="Деактивировать стиль" style="padding:2px 8px;font-size:0.85em;">
                            <i class="fa-solid fa-power-off"></i>
                        </div>
                    </div>
                    <div class="flex-row">
                        <label for="iig_style_name">Имя</label>
                        <input type="text" id="iig_style_name" class="text_pole flex1" value="${sanitizeForHtml(active.name)}">
                        <div></div>
                    </div>
                    <div class="flex-row" style="grid-template-columns:minmax(140px,180px) 1fr;">
                        <label for="iig_style_value">Промпт</label>
                        <textarea id="iig_style_value" class="text_pole flex1" rows="3" placeholder="masterpiece, cinematic lighting, painterly">${sanitizeForHtml(active.value)}</textarea>
                    </div>
                </div>
            `;
        }
    }

    bindStyleEditorEvents();
}

function bindStyleEditorEvents() {
    const settings = getSettings();
    const active = getActiveStylePreset(settings);

    document.querySelectorAll('.iig-style-chip-name').forEach(btn => {
        btn.addEventListener('click', () => {
            settings.activeStyleId = btn.dataset.styleActivate || '';
            saveSettings();
            renderStylePresets();
        });
    });

    document.querySelectorAll('.iig-style-chip-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.styleRemove;
            if (!id) return;
            removeStylePreset(id);
            saveSettings();
            renderStylePresets();
        });
    });

    if (active) {
        document.getElementById('iig_style_name')?.addEventListener('input', (e) => {
            updateStylePreset(active.id, { name: e.target.value });
            saveSettings();
            const span = document.querySelector(`[data-style-activate="${active.id}"] .iig-style-chip-label`);
            if (span) span.textContent = e.target.value.trim() || active.name;
        });

        document.getElementById('iig_style_value')?.addEventListener('input', (e) => {
            updateStylePreset(active.id, { value: e.target.value });
            saveSettings();
        });

        document.getElementById('iig_style_disable')?.addEventListener('click', () => {
            settings.activeStyleId = '';
            saveSettings();
            renderStylePresets();
        });
    }
}

function openStylePickerModal() {
    if (document.querySelector('.iig-style-overlay')) return;
    const settings = getSettings();
    const activeStyle = getActiveStylePreset(settings);

    const overlay = document.createElement('div');
    overlay.className = 'iig-style-overlay';
    overlay.innerHTML = `
        <div class="iig-style-modal">
            <div class="iig-style-modal-head">
                <span class="iig-style-modal-title"><i class="fa-solid fa-palette"></i> Выбрать стиль</span>
                <a class="iig-style-source-link" href="${IIG_STYLE_SOURCE_URL}" target="_blank" rel="noopener" title="Открыть сайт">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Сайт
                </a>
                <div class="iig-style-refresh menu_button" title="Обновить"><i class="fa-solid fa-rotate"></i></div>
                <div class="iig-style-modal-close menu_button" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="iig-style-filters"></div>
            <div class="iig-style-body"><div class="iig-style-loading">Загрузка стилей...</div></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('.iig-style-body');
    const filtersEl = overlay.querySelector('.iig-style-filters');
    const close = () => overlay.remove();

    overlay.querySelector('.iig-style-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    let siteStyles = [];
    let activeTag = '';

    const tagLabels = { painting: 'Живопись', illustration: 'Иллюстрация', film: 'Фото/фильм', game: 'Игры', cartoon: 'Мультфильмы', anime: 'Аниме', print: 'Принт', '3d': '3D' };

    const renderFilters = () => {
        const tags = Array.from(new Set(siteStyles.flatMap(s => s.tags))).sort();
        filtersEl.innerHTML = ['', ...tags].map(tag =>
            `<button class="iig-style-chip ${activeTag === tag ? 'active' : ''}" data-tag="${sanitizeForHtml(tag)}">${tag ? sanitizeForHtml(tagLabels[tag] || tag) : 'Все'}</button>`
        ).join('');
        filtersEl.querySelectorAll('.iig-style-chip').forEach(btn => {
            btn.addEventListener('click', () => { activeTag = btn.dataset.tag || ''; renderFilters(); renderGrid(); });
        });
    };

    const makeCard = (s, selected, noReplace = false) => {
        if (noReplace) {
            return `<article class="iig-site-style-card ${selected ? 'selected' : ''}">
                <div class="iig-site-style-preview iig-site-style-empty"><i class="fa-solid fa-ban"></i></div>
                <button class="iig-site-style-body" data-style-prompt="" data-style-name="" type="button">
                    <span class="iig-site-style-name">Не заменять</span>
                    <span class="iig-site-style-desc">Использовать стиль из промпта или без стиля.</span>
                </button>
            </article>`;
        }
        const img = s.images?.[0] || '';
        return `<article class="iig-site-style-card ${selected ? 'selected' : ''}">
            <div class="iig-site-style-preview">
                ${img ? `<img src="${sanitizeForHtml(img)}" alt="" loading="lazy">` : '<i class="fa-solid fa-image"></i>'}
            </div>
            <button class="iig-site-style-body" data-style-prompt="${encodeURIComponent(s.prompt)}" data-style-name="${encodeURIComponent(s.name)}" type="button">
                <span class="iig-site-style-head">
                    <span class="iig-site-style-name">${sanitizeForHtml(s.name)}</span>
                    ${s.badge ? `<span class="iig-site-style-badge">${sanitizeForHtml(s.badge)}</span>` : ''}
                </span>
                ${s.description ? `<span class="iig-site-style-desc">${sanitizeForHtml(s.description)}</span>` : ''}
            </button>
        </article>`;
    };

    const renderGrid = () => {
        const visible = activeTag ? siteStyles.filter(s => s.tags.includes(activeTag)) : siteStyles;
        bodyEl.innerHTML = `<div class="iig-style-grid">
            ${makeCard(null, !activeStyle, true)}
            ${visible.map(s => makeCard(s, activeStyle?.value === s.prompt)).join('')}
        </div>`;
        bodyEl.querySelectorAll('.iig-site-style-body').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const prompt = btn.dataset.stylePrompt ? decodeURIComponent(btn.dataset.stylePrompt) : '';
                const name = btn.dataset.styleName ? decodeURIComponent(btn.dataset.styleName) : '';
                if (!prompt) {
                    settings.activeStyleId = '';
                    saveSettings();
                    renderStylePresets();
                } else {
                    const styles = ensureStyles(settings);
                    let style = styles.find(s => s.value === prompt) || styles.find(s => s.name === name);
                    if (!style) style = createStylePreset(name);
                    updateStylePreset(style.id, { name: name || style.name, value: prompt });
                    settings.activeStyleId = style.id;
                    saveSettings();
                    renderStylePresets();
                }
                close();
            });
        });
    };

    const showStyles = (list) => { siteStyles = list; renderFilters(); renderGrid(); };

    (async () => {
        const cached = readSiteStyleCache();
        const age = cached ? Date.now() - (cached.ts || 0) : Infinity;
        if (cached?.styles?.length) {
            showStyles(cached.styles);
            fetchSiteStyles(cached, age > IIG_STYLE_CACHE_TTL).then(r => {
                if (overlay.isConnected && !r.notModified) showStyles(r.styles);
            }).catch(() => {});
        } else {
            try { showStyles((await fetchSiteStyles(null, true)).styles); }
            catch (err) { bodyEl.innerHTML = `<p class="hint" style="padding:16px;">Ошибка загрузки: ${sanitizeForHtml(err.message)}</p>`; }
        }
    })();

    overlay.querySelector('.iig-style-refresh')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        if (btn.classList.contains('is-loading')) return;
        btn.classList.add('is-loading');
        const icon = btn.querySelector('i');
        const origClass = icon?.className || '';
        if (icon) icon.className = 'fa-solid fa-spinner iig-spin-anim';
        try {
            showStyles((await fetchSiteStyles(null, true)).styles);
            toastr.success('Стили обновлены', 'Генерация картинок', { timeOut: 2000 });
        } catch (err) {
            toastr.error(`Ошибка: ${err.message}`, 'Генерация картинок');
        } finally {
            if (icon) icon.className = origClass;
            btn.classList.remove('is-loading');
        }
    });
}

function bindSettingsEvents() {
    const settings = getSettings();

    const updateVisibility = () => {
        const apiType = settings.apiType;
        const isNaistera = apiType === 'naistera';
        const isGemini = apiType === 'gemini';
        const isOpenAI = apiType === 'openai';
        const isElectronHub = apiType === 'electronhub';

        // Model is used for OpenAI/Gemini/ElectronHub; Naistera does not need a model.
        document.getElementById('iig_model_row')?.classList.toggle('iig-hidden', isNaistera);
        document.getElementById('iig_image_context_section')?.classList.remove('iig-hidden');
        document.getElementById('iig_image_context_count_row')?.classList.toggle('iig-hidden', !settings.imageContextEnabled);

        // OpenAI / VoidAI / ElectronHub params (size applies). Quality — только OpenAI/Void.
        const isOpenAIOrVoid = isOpenAI || apiType === 'void';
        const supportsSize = isOpenAIOrVoid || isElectronHub;
        document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !supportsSize);
        document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !isOpenAIOrVoid);

        // Naistera-only params
        document.getElementById('iig_naistera_model_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_aspect_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_section')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_frequency_row')?.classList.toggle('iig-hidden', !(isNaistera && settings.naisteraVideoTest));

        // ElectronHub-only section
        document.getElementById('iig_electronhub_section')?.classList.toggle('iig-hidden', !isElectronHub);

        document.getElementById('iig_naistera_hint')?.classList.toggle('iig-hidden', !isNaistera);

        const endpointInput = document.getElementById('iig_endpoint');
        if (endpointInput) {
            endpointInput.placeholder = getEndpointPlaceholder(apiType);
        }

        // Gemini aspect ratio / image size section
        const avatarSection = document.getElementById('iig_avatar_section');
        if (avatarSection) {
            avatarSection.classList.toggle('hidden', !isGemini);
        }

        // Unified refs section visible for all API types (avatars/NPC refs work for void/custom too)
        document.getElementById('iig_refs_section')?.classList.remove('iig-hidden');

        // Custom format rows visible only when apiType === 'custom'
        const isCustom = apiType === 'custom';
        document.getElementById('iig_custom_format_row')?.classList.toggle('iig-hidden', !isCustom);
        document.getElementById('iig_custom_full_url_row')?.classList.toggle('iig-hidden', !isCustom);

        // When custom is selected, also expose the size/quality/aspect rows depending on chosen format
        if (isCustom) {
            const fmt = settings.customRequestFormat || 'openai';
            const fmtIsOpenAIish = fmt === 'openai' || fmt === 'void';
            document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !fmtIsOpenAIish);
            document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !fmtIsOpenAIish);
            const avSec = document.getElementById('iig_avatar_section');
            if (avSec) avSec.classList.toggle('hidden', fmt !== 'gemini');
            document.getElementById('iig_refs_section')?.classList.remove('iig-hidden');
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

    // Show all models (отключает фильтр по image-keywords для VoidAI/Custom)
    document.getElementById('iig_show_all_models')?.addEventListener('change', (e) => {
        settings.showAllModels = e.target.checked;
        saveSettings();
        toastr.info(
            e.target.checked
                ? 'Фильтр отключён. Нажмите ⟲ чтобы перезагрузить список моделей.'
                : 'Фильтр включён. Нажмите ⟲ чтобы перезагрузить список моделей.',
            'Генерация картинок'
        );
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

        // Auto-switch to native Gemini when a gemini-family model is picked from another type.
        if (isGeminiModel(e.target.value) && settings.apiType !== 'gemini') {
            document.getElementById('iig_api_type').value = 'gemini';
            settings.apiType = 'gemini';
        }
        updateVisibility();
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

    // Кнопки-оверлеи на картинках — применяем сразу, без перерисовки сообщений.
    document.getElementById('iig_imgbtn_fullscreen')?.addEventListener('change', (e) => {
        settings.imgActionFullscreen = e.target.checked;
        saveSettings();
        applyImgActionButtonClasses();
    });
    document.getElementById('iig_imgbtn_download')?.addEventListener('change', (e) => {
        settings.imgActionDownload = e.target.checked;
        saveSettings();
        applyImgActionButtonClasses();
    });
    document.getElementById('iig_imgbtn_regen')?.addEventListener('change', (e) => {
        settings.imgActionRegen = e.target.checked;
        saveSettings();
        applyImgActionButtonClasses();
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

    // ElectronHub-specific handlers
    document.getElementById('iig_electronhub_style')?.addEventListener('input', (e) => {
        settings.electronhubStyle = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_electronhub_negative')?.addEventListener('input', (e) => {
        settings.electronhubNegativePrompt = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_electronhub_guidance')?.addEventListener('input', (e) => {
        settings.electronhubGuidanceScale = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_electronhub_steps')?.addEventListener('input', (e) => {
        settings.electronhubSteps = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_electronhub_refs')?.addEventListener('change', (e) => {
        settings.electronhubEnableReferences = e.target.checked;
        saveSettings();
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

    document.getElementById('iig_show_last_gen')?.addEventListener('click', () => {
        if (document.getElementById('iig-debug-overlay')) return;
        const d = _lastGenDebug;
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        let bodyHTML;
        if (!d) {
            bodyHTML = '<p style="text-align:center;padding:40px 20px;color:var(--SmartThemeQuoteColor);">Нет данных — сгенерируйте картинку</p>';
        } else {
            const labelMap = { char_ref: 'Персонаж', user_ref: 'Юзер', npc_ref: 'NPC', lorebook_ref: 'Лорбук', char_outfit: 'Аутфит бота', user_outfit: 'Аутфит юзера', context: 'Контекст' };
            const refCardsHTML = (d.previewRefs || []).map(r => `
                <div class="iig-dbg-ref-card">
                    <img src="${r.dataUrl}" alt="" class="iig-dbg-ref-img" onerror="this.style.display='none'">
                    <span class="iig-dbg-ref-label">${esc(labelMap[r.label] || r.label)}</span>
                </div>`).join('');

            const infoLines = [
                `<b>Время:</b> ${esc(d.timestamp)}`,
                `<b>API:</b> ${esc(d.apiType)}`,
                `<b>Модель:</b> ${esc(d.model)}`,
                `<b>Размер:</b> ${esc(d.size)}`,
                `<b>Стиль:</b> ${esc(d.style)}`,
                `<b>NPC (сматчены):</b> ${d.matchedNpcs.length ? d.matchedNpcs.map(esc).join(', ') : '—'}`,
                `<b>Лорбуки (сматчены):</b> ${d.matchedLorebook.length ? d.matchedLorebook.map(esc).join(', ') : '—'}`,
            ];

            bodyHTML = `
                <div class="iig-dbg-info">${infoLines.map(l => `<div>${l}</div>`).join('')}</div>
                ${refCardsHTML ? `<div class="iig-dbg-section-title">Референсы (${d.refCount})</div><div class="iig-dbg-refs-grid">${refCardsHTML}</div>` : ''}
                <div class="iig-dbg-section-title">Итоговый промпт</div>
                <div class="iig-dbg-prompt">${esc(d.prompt)}</div>
            `;
        }

        const overlay = document.createElement('div');
        overlay.id = 'iig-debug-overlay';
        overlay.innerHTML = `
            <div class="iig-dbg-panel">
                <div class="iig-dbg-header">
                    <span><i class="fa-solid fa-bug"></i> Последняя генерация</span>
                    <div class="iig-dbg-close" title="Закрыть"><i class="fa-solid fa-times"></i></div>
                </div>
                <div class="iig-dbg-body">${bodyHTML}</div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.iig-dbg-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    });

    // Custom format / full URL handlers
    document.getElementById('iig_custom_request_format')?.addEventListener('change', (e) => {
        settings.customRequestFormat = e.target.value;
        saveSettings();
        updateVisibility();
    });
    document.getElementById('iig_custom_full_url')?.addEventListener('input', (e) => {
        settings.customFullUrl = e.target.value;
        saveSettings();
    });

    // ── Connection presets (full configs) ──

    function presetUid() {
        return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function rebuildPresetSelect() {
        const sel = document.getElementById('iig_preset_select');
        if (!sel) return;
        const list = settings.connectionPresets || [];
        sel.innerHTML = '<option value="">-- Выберите пресет --</option>'
            + list.map(p => `<option value="${sanitizeForHtml(p.id)}" ${settings.activePresetId === p.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`).join('');
    }

    function snapshotCurrentAsPreset(name) {
        return {
            id: presetUid(),
            name: name,
            apiType: settings.apiType,
            endpoint: settings.endpoint,
            apiKey: settings.apiKey,
            model: settings.model,
            naisteraModel: settings.naisteraModel,
            naisteraAspectRatio: settings.naisteraAspectRatio,
            aspectRatio: settings.aspectRatio,
            imageSize: settings.imageSize,
            size: settings.size,
            quality: settings.quality,
            customRequestFormat: settings.customRequestFormat,
            customFullUrl: settings.customFullUrl,
        };
    }

    function applyPresetToSettings(preset) {
        if (!preset) return;
        if (preset.apiType !== undefined) settings.apiType = preset.apiType;
        if (preset.endpoint !== undefined) settings.endpoint = preset.endpoint;
        if (preset.apiKey !== undefined) settings.apiKey = preset.apiKey;
        if (preset.model !== undefined) settings.model = preset.model;
        if (preset.naisteraModel !== undefined) settings.naisteraModel = preset.naisteraModel;
        if (preset.naisteraAspectRatio !== undefined) settings.naisteraAspectRatio = preset.naisteraAspectRatio;
        if (preset.aspectRatio !== undefined) settings.aspectRatio = preset.aspectRatio;
        if (preset.imageSize !== undefined) settings.imageSize = preset.imageSize;
        if (preset.size !== undefined) settings.size = preset.size;
        if (preset.quality !== undefined) settings.quality = preset.quality;
        if (preset.customRequestFormat !== undefined) settings.customRequestFormat = preset.customRequestFormat;
        if (preset.customFullUrl !== undefined) settings.customFullUrl = preset.customFullUrl;

        // Reflect to UI
        const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
        set('iig_api_type', settings.apiType);
        set('iig_endpoint', settings.endpoint);
        set('iig_api_key', settings.apiKey);
        set('iig_custom_request_format', settings.customRequestFormat);
        set('iig_custom_full_url', settings.customFullUrl);
        set('iig_naistera_model', normalizeNaisteraModel(settings.naisteraModel));
        set('iig_naistera_aspect_ratio', settings.naisteraAspectRatio);
        set('iig_aspect_ratio', settings.aspectRatio);
        set('iig_image_size', settings.imageSize);
        set('iig_size', settings.size);
        set('iig_quality', settings.quality);

        // Model select: rebuild with just the preset model as option
        const modelSel = document.getElementById('iig_model');
        if (modelSel) {
            if (settings.model) {
                modelSel.innerHTML = `<option value="${sanitizeForHtml(settings.model)}" selected>${sanitizeForHtml(settings.model)}</option>`;
            } else {
                modelSel.innerHTML = '<option value="">-- Выберите модель --</option>';
            }
        }
    }

    document.getElementById('iig_preset_select')?.addEventListener('change', (e) => {
        settings.activePresetId = e.target.value || '';
        saveSettings();
    });

    document.getElementById('iig_preset_load')?.addEventListener('click', () => {
        const sel = document.getElementById('iig_preset_select');
        const id = sel?.value || '';
        if (!id) { toastr.warning('Выберите пресет для загрузки', 'Пресеты'); return; }
        const preset = (settings.connectionPresets || []).find(p => p.id === id);
        if (!preset) { toastr.error('Пресет не найден', 'Пресеты'); return; }
        applyPresetToSettings(preset);
        settings.activePresetId = id;
        saveSettings();
        updateVisibility();
        toastr.success(`Загружен пресет: ${preset.name}`, 'Пресеты', { timeOut: 2000 });
    });

    document.getElementById('iig_preset_save')?.addEventListener('click', () => {
        const name = (prompt('Название пресета:') || '').trim();
        if (!name) return;
        if (!Array.isArray(settings.connectionPresets)) settings.connectionPresets = [];
        const preset = snapshotCurrentAsPreset(name);
        settings.connectionPresets.push(preset);
        settings.activePresetId = preset.id;
        saveSettings();
        rebuildPresetSelect();
        toastr.success(`Пресет «${name}» сохранён`, 'Пресеты', { timeOut: 2000 });
    });

    document.getElementById('iig_preset_update')?.addEventListener('click', () => {
        const sel = document.getElementById('iig_preset_select');
        const id = sel?.value || '';
        if (!id) { toastr.warning('Выберите пресет для обновления', 'Пресеты'); return; }
        const list = settings.connectionPresets || [];
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) { toastr.error('Пресет не найден', 'Пресеты'); return; }
        const old = list[idx];
        const updated = snapshotCurrentAsPreset(old.name);
        updated.id = old.id;
        list[idx] = updated;
        saveSettings();
        toastr.success(`Пресет «${old.name}» обновлён`, 'Пресеты', { timeOut: 2000 });
    });

    document.getElementById('iig_preset_delete')?.addEventListener('click', () => {
        const sel = document.getElementById('iig_preset_select');
        const id = sel?.value || '';
        if (!id) { toastr.warning('Выберите пресет для удаления', 'Пресеты'); return; }
        const list = settings.connectionPresets || [];
        const preset = list.find(p => p.id === id);
        if (!preset) return;
        if (!confirm(`Удалить пресет «${preset.name}»?`)) return;
        settings.connectionPresets = list.filter(p => p.id !== id);
        if (settings.activePresetId === id) settings.activePresetId = '';
        saveSettings();
        rebuildPresetSelect();
        toastr.info(`Пресет «${preset.name}» удалён`, 'Пресеты', { timeOut: 2000 });
    });

    // ── Профили (глобальные снимки настроек) ──
    // Карта «ключ настройки → [id поля, способ записи]» для отражения скаляров после загрузки профиля.
    const PROFILE_INPUT_MAP = {
        apiType: ['iig_api_type', 'value'], endpoint: ['iig_endpoint', 'value'], apiKey: ['iig_api_key', 'value'],
        model: ['iig_model', 'value'], customRequestFormat: ['iig_custom_request_format', 'value'], customFullUrl: ['iig_custom_full_url', 'value'],
        showAllModels: ['iig_show_all_models', 'checked'],
        size: ['iig_size', 'value'], quality: ['iig_quality', 'value'], aspectRatio: ['iig_aspect_ratio', 'value'], imageSize: ['iig_image_size', 'value'],
        maxRetries: ['iig_max_retries', 'value'], retryDelay: ['iig_retry_delay', 'value'],
        naisteraModel: ['iig_naistera_model', 'value'], naisteraAspectRatio: ['iig_naistera_aspect_ratio', 'value'],
        naisteraVideoTest: ['iig_naistera_video_test', 'checked'], naisteraVideoEveryN: ['iig_naistera_video_every_n', 'value'],
        electronhubStyle: ['iig_electronhub_style', 'value'], electronhubNegativePrompt: ['iig_electronhub_negative', 'value'],
        electronhubGuidanceScale: ['iig_electronhub_guidance', 'value'], electronhubSteps: ['iig_electronhub_steps', 'value'],
        electronhubEnableReferences: ['iig_electronhub_refs', 'checked'],
        imgActionFullscreen: ['iig_imgbtn_fullscreen', 'checked'], imgActionDownload: ['iig_imgbtn_download', 'checked'],
        imgActionRegen: ['iig_imgbtn_regen', 'checked'],
        imageContextEnabled: ['iig_image_context_enabled', 'checked'], imageContextCount: ['iig_image_context_count', 'value'],
        enabled: ['iig_enabled', 'checked'], externalBlocks: ['iig_external_blocks', 'checked'],
        visionEndpoint: ['iig_vision_endpoint', 'value'], visionApiKey: ['iig_vision_api_key', 'value'],
        visionModel: ['iig_vision_model', 'value'], visionPrompt: ['iig_vision_prompt', 'value'],
        historyPicEnabled: ['iig_historypic_enabled', 'checked'], historyPicLlm: ['iig_historypic_llm', 'value'],
        historyPicMaxMessages: ['iig_historypic_max', 'value'],
        historyPicQuote: ['iig_historypic_quote', 'checked'], historyPicHideFromContext: ['iig_historypic_hide', 'checked'],
        // historyPicTaskPrompt/Presets/PresetId отражает renderHistoryPicPresetUi() ниже.
    };

    function renderProfileSelect() {
        const sel = document.getElementById('iig_profile_select');
        if (!sel) return;
        const list = settings.profiles || [];
        sel.innerHTML = `<option value="">-- Выберите профиль --</option>`
            + list.map(p => `<option value="${sanitizeForHtml(p.id)}" ${settings.activeProfileId === p.id ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`).join('');
        const cnt = document.getElementById('iig_profile_count');
        if (cnt) cnt.textContent = list.length || '';
    }

    function ensureSelectOption(id, val) {
        const sel = document.getElementById(id);
        if (!sel || !val) return;
        if (!Array.from(sel.options).some(o => o.value === val)) {
            const o = document.createElement('option');
            o.value = val; o.textContent = val;
            sel.appendChild(o);
        }
    }

    function applyProfileAndRefresh(profile) {
        const applied = applyProfileToSettings(profile, settings);
        ensureSelectOption('iig_model', settings.model);
        ensureSelectOption('iig_vision_model', settings.visionModel);
        for (const [key, [id, prop]] of Object.entries(PROFILE_INPUT_MAP)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (prop === 'checked') el.checked = Boolean(settings[key]);
            else el.value = settings[key] ?? '';
        }
        // Коллекции перерисовываем безопасно (секция могла не входить в профиль — тогда покажет текущее).
        try { renderRefSlots(); bindRefSlotEvents(); } catch (_) {}
        try { renderAvatarGrid('char'); renderAvatarGrid('user'); } catch (_) {}
        try { renderLorebookUI(); bindLorebookRefCardEvents(); } catch (_) {}
        try { renderStylePresets(); } catch (_) {}
        try { renderHistoryPicPresetUi(); } catch (_) {}
        try { ensureHistoryPicWandButton(); } catch (_) {}
        try { applyImgActionButtonClasses(); } catch (_) {}
        updateVisibility();
        return applied;
    }

    document.getElementById('iig_profile_select')?.addEventListener('change', (e) => {
        settings.activeProfileId = e.target.value || '';
        saveSettings();
    });

    document.getElementById('iig_profile_load')?.addEventListener('click', () => {
        const id = document.getElementById('iig_profile_select')?.value || '';
        if (!id) { toastr.warning('Выберите профиль для загрузки', 'Профили'); return; }
        const profile = (settings.profiles || []).find(p => p.id === id);
        if (!profile) { toastr.error('Профиль не найден', 'Профили'); return; }
        const applied = applyProfileAndRefresh(profile);
        settings.activeProfileId = id;
        saveSettings();
        const labels = applied.map(sid => PROFILE_SECTION_BY_ID[sid]?.label || sid).join(', ');
        toastr.success(`Загружен профиль «${profile.name}». Секции: ${labels || '—'}`, 'Профили', { timeOut: 3000 });
    });

    document.getElementById('iig_profile_save')?.addEventListener('click', () => {
        const scope = getProfileSaveScope(settings);
        if (!Object.values(scope).some(Boolean)) { toastr.warning('Отметьте хотя бы одну секцию в «Что сохранять»', 'Профили'); return; }
        const name = (prompt('Название профиля:') || '').trim();
        if (!name) return;
        const profile = profileCreate(name, scope, settings);
        saveSettings();
        renderProfileSelect();
        toastr.success(`Профиль «${profile.name}» сохранён (${profile.sections.length} секц.)`, 'Профили', { timeOut: 2500 });
    });

    document.getElementById('iig_profile_update')?.addEventListener('click', () => {
        const id = document.getElementById('iig_profile_select')?.value || '';
        if (!id) { toastr.warning('Выберите профиль для обновления', 'Профили'); return; }
        const list = settings.profiles || [];
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) { toastr.error('Профиль не найден', 'Профили'); return; }
        const scope = getProfileSaveScope(settings);
        if (!Object.values(scope).some(Boolean)) { toastr.warning('Отметьте хотя бы одну секцию', 'Профили'); return; }
        const snap = snapshotProfileSections(scope, settings);
        list[idx] = { ...list[idx], sections: snap.sections, data: snap.data };
        saveSettings();
        toastr.success(`Профиль «${list[idx].name}» обновлён (${snap.sections.length} секц.)`, 'Профили', { timeOut: 2500 });
    });

    document.getElementById('iig_profile_delete')?.addEventListener('click', () => {
        const id = document.getElementById('iig_profile_select')?.value || '';
        if (!id) { toastr.warning('Выберите профиль для удаления', 'Профили'); return; }
        const list = settings.profiles || [];
        const profile = list.find(p => p.id === id);
        if (!profile) return;
        if (!confirm(`Удалить профиль «${profile.name}»?`)) return;
        settings.profiles = list.filter(p => p.id !== id);
        if (settings.activeProfileId === id) settings.activeProfileId = '';
        saveSettings();
        renderProfileSelect();
        toastr.info(`Профиль «${profile.name}» удалён`, 'Профили', { timeOut: 2000 });
    });

    document.getElementById('iig_profile_export')?.addEventListener('click', () => {
        const id = document.getElementById('iig_profile_select')?.value || '';
        if (!id) { toastr.warning('Выберите профиль для экспорта', 'Профили'); return; }
        const profile = (settings.profiles || []).find(p => p.id === id);
        if (!profile) return;
        const hasSecret = (profile.sections || []).some(sid => PROFILE_SECTION_BY_ID[sid]?.secret?.length);
        const json = buildProfileExportJson(profile, { stripSecrets: true });
        const safe = (profile.name || 'profile').replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '_').slice(0, 64) || 'profile';
        triggerBrowserDownload(`${safe}.iig-profile.json`, JSON.stringify(json, null, 2));
        toastr.success(`Экспорт: ${safe}.iig-profile.json${hasSecret ? ' (ключи вырезаны)' : ''}`, 'Профили', { timeOut: 3000 });
    });

    document.getElementById('iig_profile_import')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,.iig-profile.json';
        inp.addEventListener('change', async () => {
            const file = inp.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const payload = parseProfileJson(text);
                const profile = profileImportFromPayload(payload, settings);
                saveSettings();
                renderProfileSelect();
                toastr.success(`Импортирован «${profile.name}» (${profile.sections.length} секц.). Нажмите «Загрузить», чтобы применить.`, 'Профили', { timeOut: 4000 });
            } catch (err) {
                toastr.error(`Ошибка импорта: ${err.message}`, 'Профили');
            }
        });
        inp.click();
    });

    document.querySelectorAll('.iig-profile-scope-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const section = e.target.dataset.section;
            if (!section) return;
            // Клон-на-запись: settings.profileSaveScope может быть общей ссылкой на (shallow-frozen) дефолт.
            settings.profileSaveScope = { ...getProfileSaveScope(settings), [section]: e.target.checked };
            saveSettings();
        });
    });

    // ── Tab switching for refs mega-section ──
    document.querySelectorAll('#iig_refs_mega_section .iig-ref-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('#iig_refs_mega_section .iig-ref-tab').forEach(t => t.classList.toggle('iig-ref-tab-active', t.dataset.tab === target));
            document.querySelectorAll('#iig_refs_mega_section .iig-ref-tab-content').forEach(p => p.classList.toggle('iig-ref-tab-content-active', p.dataset.tabContent === target));
        });
    });

    // ── Unified ref slots ──
    renderRefSlots();
    bindRefSlotEvents();

    // ── Lorebook refs ──
    renderLorebookUI();
    bindLorebookEvents();

    // ── Vision API settings ──
    bindVisionSettingsEvents();

    // ── Иллюстрация сцены ──
    bindHistoryPicSettingsEvents();
    renderHistoryPicPresetUi();

    // ── Wardrobe handlers ──
    document.getElementById('sw_open_wardrobe')?.addEventListener('click', () => {
        if (window.sillyWardrobe?.isReady()) {
            window.sillyWardrobe.openModal();
        } else {
            toastr.error('Гардероб не загружен', 'Гардероб');
        }
    });
    const swPlacementSel = document.getElementById('sw_btn_placement');
    if (swPlacementSel) {
        swPlacementSel.value = window.sillyWardrobe?.getPlacement?.() || 'bar';
        swPlacementSel.addEventListener('change', () => {
            // setPlacement сам сохраняет настройку и перерисовывает кнопку (строка ввода / плавающая / палочка).
            window.sillyWardrobe?.setPlacement?.(swPlacementSel.value);
        });
    }
    document.getElementById('sw_max_dim')?.addEventListener('change', (e) => {
        const ctx = SillyTavern.getContext();
        if (ctx.extensionSettings.silly_wardrobe) {
            ctx.extensionSettings.silly_wardrobe.maxDimension = Math.max(128, Math.min(1024, parseInt(e.target.value) || 512));
            ctx.saveSettingsDebounced();
        }
    });

    // ── Style presets ──
    // Сворачивание карточек настроек (состояние запоминается в settings[flag]).
    function bindCardToggle(toggleId, bodyId, flag) {
        document.getElementById(toggleId)?.addEventListener('click', () => {
            const s = getSettings();
            s[flag] = !s[flag];
            saveSettings();
            document.getElementById(bodyId)?.classList.toggle('iig-hidden', !s[flag]);
            const toggle = document.getElementById(toggleId);
            toggle?.classList.toggle('iig-card-collapsed', !s[flag]);
            const chevron = toggle?.querySelector('.iig-card-chevron');
            if (chevron) {
                chevron.classList.toggle('fa-chevron-right', !s[flag]);
                chevron.classList.toggle('fa-chevron-down', s[flag]);
            }
        });
    }
    bindCardToggle('iig_styles_toggle', 'iig_styles_body', 'stylesOpen');
    bindCardToggle('iig_profile_toggle', 'iig_profile_body', 'profilesOpen');
    bindCardToggle('iig_historypic_toggle', 'iig_historypic_body', 'historyPicOpen');
    bindCardToggle('iig_api_toggle', 'iig_api_body', 'apiOpen');
    bindCardToggle('iig_image_context_toggle', 'iig_image_context_body', 'imageContextOpen');
    bindCardToggle('iig_genparams_toggle', 'iig_genparams_body', 'genParamsOpen');
    bindCardToggle('iig_refs_toggle', 'iig_refs_body', 'refsOpen');
    bindCardToggle('iig_electronhub_toggle', 'iig_electronhub_body', 'electronhubOpen');
    bindCardToggle('iig_debug_toggle', 'iig_debug_body', 'debugOpen');

    document.getElementById('iig_style_add')?.addEventListener('click', () => {
        const inp = document.getElementById('iig_new_style_name');
        const name = (inp?.value || '').trim();
        if (!name) { toastr.warning('Введите название стиля', 'Стили'); return; }
        createStylePreset(name);
        saveSettings();
        if (inp) inp.value = '';
        renderStylePresets();
    });

    document.getElementById('iig_style_pick_site')?.addEventListener('click', () => openStylePickerModal());

    renderStylePresets();

    // Apply initial state
    updateVisibility();
}

/**
 * ═══════════════════════════════════════════
 * Fullscreen image viewer with zoom
 * ═══════════════════════════════════════════
 */
function openFullscreenViewer(imgSrc) {
    if (!imgSrc) return;
    closeFullscreenViewer();
    const overlay = document.createElement('div');
    overlay.id = 'iig-fullscreen-overlay';
    overlay.classList.add('iig-fs-fit');

    const img = document.createElement('img');
    img.className = 'iig-fs-image';
    img.src = imgSrc;
    img.alt = 'Fullscreen';
    img.draggable = false;

    const closeBtn = document.createElement('div');
    closeBtn.className = 'iig-fs-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeFullscreenViewer(); });
    closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); closeFullscreenViewer(); });

    // Скачать оригинал (клик обрабатывается глобальной делегацией — см. initGlobalClickHandler).
    const downloadBtn = document.createElement('div');
    downloadBtn.className = 'iig-fs-download';
    downloadBtn.title = 'Скачать оригинал';
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';

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
    overlay.appendChild(downloadBtn);
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
    // ── Touch support: detect touch device ──
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
        // On touch devices, toggle iig-touch-active to show/hide action buttons
        document.addEventListener('touchstart', (e) => {
            const btn = e.target.closest('.iig-image-action-btn');
            if (btn) return; // don't interfere with button taps
            const wrapper = e.target.closest('.iig-image-wrapper');
            document.querySelectorAll('.iig-image-wrapper.iig-touch-active').forEach(w => {
                if (w !== wrapper) w.classList.remove('iig-touch-active');
            });
            if (wrapper) wrapper.classList.toggle('iig-touch-active');
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

            // Download button — скачать оригинал открытой картинки
            if (e.target.closest('.iig-fs-download')) {
                e.preventDefault();
                e.stopPropagation();
                const src = overlay.querySelector('.iig-fs-image')?.getAttribute('src') || '';
                if (src) iigDownloadImage(src);
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

        // Fullscreen button on image wrapper — read src from dataset
        const fsBtn = e.target.closest('.iig-fullscreen-btn');
        if (fsBtn) {
            e.preventDefault();
            e.stopPropagation();
            const src = fsBtn.dataset.imgSrc || '';
            if (src) openFullscreenViewer(src);
            return;
        }

        // Download button on image wrapper — скачать оригинал прямо с панельки
        const dlBtn = e.target.closest('.iig-download-btn');
        if (dlBtn) {
            e.preventDefault();
            e.stopPropagation();
            const dlSrc = dlBtn.dataset.imgSrc || '';
            if (dlSrc) iigDownloadImage(dlSrc);
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

        // Direct click/tap on an IIG image → fullscreen
        const clickedImg = e.target.closest('.iig-image-wrapper img, img.iig-generated-image, img[data-iig-instruction]');
        if (clickedImg) {
            const src = clickedImg.getAttribute('src') || '';
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
// Видимость кнопок-оверлеев на картинках — классами на body: применяется мгновенно
// ко всем уже отрисованным картинкам, без перерисовки сообщений.
function applyImgActionButtonClasses() {
    const settings = getSettings();
    const b = document.body;
    if (!b) return;
    b.classList.toggle('iig-btn-no-fullscreen', settings.imgActionFullscreen === false);
    b.classList.toggle('iig-btn-no-download', settings.imgActionDownload !== true);
    b.classList.toggle('iig-btn-no-regen', settings.imgActionRegen === false);
}

function wrapImageWithActions(mediaElement, tag, messageId, tagIndex, totalTags) {
    if (mediaElement.tagName !== 'IMG') return mediaElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'iig-image-wrapper';
    wrapper.dataset.tagIndex = String(tagIndex);

    const actions = document.createElement('div');
    actions.className = 'iig-image-actions';

    // Fullscreen button — stores src in dataset, handled by delegation
    const fullscreenBtn = document.createElement('div');
    fullscreenBtn.className = 'iig-image-action-btn iig-fullscreen-btn';
    fullscreenBtn.title = 'На весь экран';
    fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    fullscreenBtn.dataset.imgSrc = mediaElement.src || mediaElement.getAttribute('src') || '';
    actions.appendChild(fullscreenBtn);

    // Скачивание оригинала — НЕ здесь: кнопка ⬇ живёт в полноэкранном вьюере (открывается тапом
    // по картинке), чтобы не раздувать панельку действий (просьба юзера: две кнопки, не три).

    // Скачать оригинал — по умолчанию скрыта настройкой (см. applyImgActionButtonClasses).
    const dlBtn = document.createElement('div');
    dlBtn.className = 'iig-image-action-btn iig-download-btn';
    dlBtn.title = 'Скачать оригинал';
    dlBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
    dlBtn.dataset.imgSrc = mediaElement.src || mediaElement.getAttribute('src') || '';
    actions.appendChild(dlBtn);

    // Per-image regeneration button — stores ids in dataset, handled by delegation
    const regenBtn = document.createElement('div');
    regenBtn.className = 'iig-image-action-btn iig-regen-single-btn';
    regenBtn.title = 'Перегенерировать эту картинку';
    regenBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenBtn.dataset.messageId = String(messageId);
    regenBtn.dataset.tagIndex = String(tagIndex);
    actions.appendChild(regenBtn);

    wrapper.appendChild(actions);
    mediaElement.style.cursor = 'zoom-in';
    wrapper.appendChild(mediaElement);
    return wrapper;
}

/**
 * Wrap an error image with ONLY a regen button (no fullscreen).
 */
function wrapErrorImageWithRegen(errorImg, messageId, tagIndex) {
    const wrapper = document.createElement('div');
    // iig-error-wrap: у ошибок кнопка перегенерации не прячется настройкой (иначе не оживить).
    wrapper.className = 'iig-image-wrapper iig-error-wrap';
    wrapper.dataset.tagIndex = String(tagIndex);

    const actions = document.createElement('div');
    actions.className = 'iig-image-actions';

    const regenBtn = document.createElement('div');
    regenBtn.className = 'iig-image-action-btn iig-regen-single-btn';
    regenBtn.title = 'Перегенерировать эту картинку';
    regenBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    regenBtn.dataset.messageId = String(messageId);
    regenBtn.dataset.tagIndex = String(tagIndex);
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

    const taskKey = singleTagTaskKey(messageId, targetTagIndex);
    if (activeSingleTagTasks.has(taskKey)) {
        toastr.info('Эта картинка уже генерируется', 'Генерация картинок', { timeOut: 2000 });
        return;
    }

    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    const mesTextEl = messageElement?.querySelector('.mes_text');
    if (!mesTextEl) {
        toastr.error('Элемент сообщения не найден', 'Генерация картинок');
        return;
    }

    const tag = tags[targetTagIndex];
    iigLog('INFO', `Regenerating single image ${targetTagIndex} in message ${messageId}`);
    toastr.info('Перегенерация 1 картинки...', 'Генерация картинок');

    activeSingleTagTasks.add(taskKey);
    const tagId = `iig-regen-single-${messageId}-${targetTagIndex}`;
    let loadingPlaceholder = null;
    let replacedEl = null;

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
            // DOM протух (вечный спиннер от упавшей попытки, потерянные обёртки) —
            // восстанавливаем разметку из источника и ищем ещё раз.
            rerenderMessageFromSource(messageId);
            targetEl = mesTextEl.querySelector(`.iig-image-wrapper[data-tag-index="${targetTagIndex}"]`)
                || Array.from(mesTextEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]'))[targetTagIndex]
                || null;
        }
        if (!targetEl) {
            toastr.error('Элемент картинки не найден', 'Генерация картинок');
            return;
        }

        const instruction = targetEl.querySelector?.('img[data-iig-instruction]')?.getAttribute('data-iig-instruction')
            || targetEl.getAttribute?.('data-iig-instruction');

        replacedEl = targetEl;
        loadingPlaceholder = createLoadingPlaceholder(tagId);
        targetEl.replaceWith(loadingPlaceholder);

        const statusEl = loadingPlaceholder.querySelector('.iig-status');

        const generated = await generateImageWithRetry(
            tag.prompt,
            resolveEffectiveStyle(tag.style),
            (status) => { statusEl.textContent = status; },
            { aspectRatio: tag.aspectRatio, imageSize: tag.imageSize, quality: tag.quality, preset: tag.preset, messageId, signal: getLoadingSignal(loadingPlaceholder) }
        );
        finishLoadingGeneration(loadingPlaceholder);
        clearLoadingPlaceholderTimer(loadingPlaceholder);

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
        mediaElement.dataset.iigTagIndex = String(targetTagIndex);

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
        clearLoadingPlaceholderTimer(loadingPlaceholder);
        const cancelled = isGenerationCancelled(error, getLoadingSignal(loadingPlaceholder));
        // Возвращаем старую картинку на место вместо вечного спиннера —
        // кнопки действий сохраняются, можно повторить попытку.
        if (loadingPlaceholder?.isConnected && replacedEl) {
            loadingPlaceholder.replaceWith(replacedEl);
        }
        iigLog(cancelled ? 'INFO' : 'ERROR', `Single image regeneration ${cancelled ? 'cancelled' : 'failed'}: ${error.message}`);
        if (cancelled) toastr.info('Генерация отменена', 'Генерация картинок', { timeOut: 2500 });
        else toastr.error(`Ошибка: ${error.message}`, 'Генерация картинок');
    } finally {
        activeSingleTagTasks.delete(taskKey);
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

/* ═══════════════════════════════════════════════════════════════
   ГАЛЕРЕЯ ЧАТА (порт из novarakk)
   Модалка с сеткой сгенерированных картинок и файловыми действиями:
   просмотр (фуллскрин-вьюер), выбор, массовое скачивание/удаление,
   пагинация, сортировка, размер тумбнейлов.

   Два скоупа, переключаются в шапке:
     'chat'      — картинки из сообщений текущего чата (по DOM);
     'character' — все файлы картинок персонажа
                   (user/images/<имя персонажа>/, через /api/images/list).
   ═══════════════════════════════════════════════════════════════ */

// Свой id (не iig_gallery_overlay): если рядом установлен novarakk — не конфликтуем.
const GALLERY_OVERLAY_ID = 'iig_si_gallery_overlay';
const GALLERY_PAGE_SIZE_OPTIONS = [6, 12, 24, 48];
const GALLERY_DEFAULT_PER_PAGE = 12;
const GALLERY_THUMB_SIZE_OPTIONS = [80, 130, 180, 240];
const GALLERY_DEFAULT_THUMB_SIZE = 130;

function iigEscapeRegex(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// data-iig-instruction (HTML-сущности) → объект {prompt, style, ...} или null.
function parseInstructionAttr(instruction) {
    if (!instruction) return null;
    try {
        const decoded = String(instruction)
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&#34;/g, '"')
            .replace(/&amp;/g, '&');
        const parsed = JSON.parse(decoded);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

// ── Сбор картинок из текущего чата (по DOM) ──

function collectChatImages() {
    const context = SillyTavern.getContext();
    if (!context.chat || context.chat.length === 0) return [];

    const results = [];
    const messageElements = document.querySelectorAll('#chat .mes');

    for (const mesEl of messageElements) {
        const mesId = mesEl.getAttribute('mesid');
        if (mesId === null) continue;
        const messageId = parseInt(mesId, 10);
        const message = context.chat[messageId];
        if (!message) continue;

        // Новый формат (data-iig-instruction) + legacy-картинки (.iig-generated-image без инструкции)
        const imgs = Array.from(mesEl.querySelectorAll('img[data-iig-instruction], img.iig-generated-image'));
        const seen = new Set();
        let tagIndex = -1;
        for (const img of imgs) {
            if (seen.has(img)) continue;
            seen.add(img);
            tagIndex++;
            const src = img.getAttribute('src') || '';
            if (!src || src.includes('[IMG:') || src.includes('[VID:')) continue;
            if (img.classList.contains('iig-error-image') || src.includes('error.svg')) continue;

            const data = parseInstructionAttr(img.getAttribute('data-iig-instruction'));
            const prompt = data?.prompt || img.alt || '';
            const style = data?.style || '';
            const absSrc = img.src;
            let filename = absSrc.includes('/') ? absSrc.split('/').pop() : absSrc;
            try { filename = decodeURIComponent(filename); } catch { /* кривый URL — оставляем как есть */ }

            results.push({
                src: absSrc,
                prompt,
                style,
                messageId,
                tagIndex,
                order: results.length,
                filename: filename || `image_${tagIndex}`,
                isUser: !!message.is_user,
                charName: message.name || '',
            });
        }
    }

    return results;
}

// ── Сбор всех картинок текущего персонажа (с диска) ──

async function getCharacterFolder() {
    const context = SillyTavern.getContext();
    // Та же логика выбора папки, что и при сохранении в saveImageToFile
    let charName = 'generated';
    if (context.characterId !== undefined && context.characters?.[context.characterId]) {
        charName = context.characters[context.characterId].name || 'generated';
    }
    try {
        const resp = await fetch('/api/files/sanitize-filename', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ fileName: charName }),
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.fileName) return data.fileName;
        }
    } catch { /* fall back to raw name */ }
    return charName;
}

async function collectCharacterImages() {
    const context = SillyTavern.getContext();
    const folder = await getCharacterFolder();
    const resp = await fetch('/api/images/list', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ folder, sortField: 'date', sortOrder: 'asc' }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const files = await resp.json();
    const list = Array.isArray(files) ? files.filter(f => typeof f === 'string') : [];

    return list.map((file, i) => ({
        src: `user/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`,
        diskPath: `user/images/${folder}/${file}`,
        prompt: '',
        style: '',
        messageId: null,
        tagIndex: 0,
        order: i,
        filename: file,
        isUser: false,
        charName: folder,
    }));
}

// ── Состояние галереи ──

let galleryState = {
    images: [],
    selected: new Set(),
    selectMode: false,
    page: 0,
    sort: 'newest',
    scope: 'chat', // 'chat' | 'character'
    perPage: GALLERY_DEFAULT_PER_PAGE,
    thumbSize: GALLERY_DEFAULT_THUMB_SIZE,
    showThumbSlider: false,
};

function resetGalleryState() {
    const perPage = galleryState.perPage || GALLERY_DEFAULT_PER_PAGE;
    const thumbSize = galleryState.thumbSize || GALLERY_DEFAULT_THUMB_SIZE;
    const scope = galleryState.scope || 'chat';
    galleryState = { images: [], selected: new Set(), selectMode: false, page: 0, sort: 'newest', scope, perPage, thumbSize, showThumbSlider: false };
}

function getSortedGalleryImages() {
    const imgs = galleryState.images.slice();
    switch (galleryState.sort) {
        case 'oldest':
            imgs.sort((a, b) => a.order - b.order);
            break;
        case 'name-asc':
            imgs.sort((a, b) => a.filename.localeCompare(b.filename));
            break;
        case 'name-desc':
            imgs.sort((a, b) => b.filename.localeCompare(a.filename));
            break;
        default: // newest
            imgs.sort((a, b) => b.order - a.order);
            break;
    }
    return imgs;
}

function getGalleryTotalPages() {
    return Math.max(1, Math.ceil(getSortedGalleryImages().length / galleryState.perPage));
}

function getGalleryPageImages() {
    const sorted = getSortedGalleryImages();
    const start = galleryState.page * galleryState.perPage;
    return sorted.slice(start, start + galleryState.perPage);
}

function clampGalleryPage() {
    const tp = getGalleryTotalPages();
    if (galleryState.page >= tp) galleryState.page = Math.max(0, tp - 1);
}

// ── Обновление содержимого ──

let galleryLoadToken = 0;

async function refreshGallery() {
    const overlay = document.getElementById(GALLERY_OVERLAY_ID);
    if (!overlay) return;
    const bodyEl = overlay.querySelector('#iig_gallery_body');
    const token = ++galleryLoadToken;
    galleryState.selected.clear();

    if (galleryState.scope === 'character' && bodyEl) {
        bodyEl.innerHTML = '<div class="iig-gallery-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Загрузка картинок…</p></div>';
    }

    let images;
    try {
        images = galleryState.scope === 'character' ? await collectCharacterImages() : collectChatImages();
    } catch (err) {
        iigLog('ERROR', 'Gallery: failed to load images:', err);
        if (token === galleryLoadToken && bodyEl) {
            bodyEl.innerHTML = '<div class="iig-gallery-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Не удалось загрузить картинки</p></div>';
        }
        return;
    }

    if (token !== galleryLoadToken || !document.getElementById(GALLERY_OVERLAY_ID)) return;
    galleryState.images = images;
    clampGalleryPage();
    updateGallerySelectionUI(overlay);
    if (bodyEl) renderGalleryContent(bodyEl);
}

// ── Модалка галереи ──

function openGallery() {
    if (document.getElementById(GALLERY_OVERLAY_ID)) return;

    resetGalleryState();

    const overlay = document.createElement('div');
    overlay.id = GALLERY_OVERLAY_ID;
    overlay.className = 'iig-gallery-overlay';

    overlay.innerHTML = `
        <div class="iig-gallery-modal">
            <div class="iig-gallery-header">
                <span class="iig-gallery-title"><i class="fa-solid fa-images"></i> Галерея</span>
                <span class="iig-gallery-count" id="iig_gallery_count"></span>
                <button class="iig-gallery-btn iig-gallery-close iig-gallery-close-mobile" id="iig_gallery_close_mobile" type="button" title="Закрыть">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <div class="iig-gallery-header-actions">
                    <div class="iig-gallery-scope" id="iig_gallery_scope">
                        <button class="iig-gallery-scope-btn ${galleryState.scope === 'chat' ? 'active' : ''}" data-gallery-scope="chat" type="button" title="Картинки из текущего чата">
                            <i class="fa-solid fa-comment"></i> Чат
                        </button>
                        <button class="iig-gallery-scope-btn ${galleryState.scope === 'character' ? 'active' : ''}" data-gallery-scope="character" type="button" title="Все картинки этого персонажа">
                            <i class="fa-solid fa-user"></i> Все
                        </button>
                    </div>
                    <select class="iig-gallery-sort" id="iig_gallery_sort" title="Сортировка">
                        <option value="newest" selected>Новые</option>
                        <option value="oldest">Старые</option>
                        <option value="name-asc">A → Z</option>
                        <option value="name-desc">Z → A</option>
                    </select>
                    <select class="iig-gallery-perpage" id="iig_gallery_perpage" title="На странице">
                        ${GALLERY_PAGE_SIZE_OPTIONS.map(n => `<option value="${n}" ${n === galleryState.perPage ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                    <button class="iig-gallery-btn" id="iig_gallery_select_toggle" type="button" title="Режим выбора">
                        <i class="fa-regular fa-square-check"></i>
                    </button>
                    <button class="iig-gallery-btn" id="iig_gallery_select_all" type="button" title="Выбрать все" style="display:none">
                        <i class="fa-solid fa-check-double"></i>
                    </button>
                    <button class="iig-gallery-btn iig-gallery-btn-danger" id="iig_gallery_delete_selected" type="button" title="Удалить выбранные" style="display:none">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <button class="iig-gallery-btn" id="iig_gallery_download_selected" type="button" title="Скачать выбранные" style="display:none">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="iig-gallery-btn" id="iig_gallery_thumbsize_toggle" type="button" title="Размер тумбнейлов">
                        <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                    </button>
                    <button class="iig-gallery-btn iig-gallery-close" id="iig_gallery_close" type="button" title="Закрыть">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div class="iig-gallery-body" id="iig_gallery_body"></div>
            <div class="iig-gallery-footer" id="iig_gallery_footer"></div>
        </div>
    `;

    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.iig-gallery-modal');
    const bodyEl = overlay.querySelector('#iig_gallery_body');

    // Закрытие
    const close = () => {
        if (!overlay.isConnected) return;
        overlay._chatObserver?.disconnect();
        if (overlay._chatRefreshTimer) clearTimeout(overlay._chatRefreshTimer);
        resetGalleryState();
        overlay.remove();
    };
    const closeFromControl = (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    for (const closeButton of overlay.querySelectorAll('.iig-gallery-close')) {
        closeButton.addEventListener('click', closeFromControl);
        closeButton.addEventListener('pointerup', closeFromControl);
        closeButton.addEventListener('touchend', closeFromControl, { passive: false });
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape' && document.getElementById(GALLERY_OVERLAY_ID)) {
            e.stopPropagation();
            close();
            document.removeEventListener('keydown', escHandler, true);
        }
    }, true);

    // Гасим всплытие, чтобы клики по модалке не утекали в чат
    for (const ev of ['click', 'mousedown', 'pointerdown']) {
        modal.addEventListener(ev, (e) => e.stopPropagation());
    }

    // Синхронизация чат-скоупа с завершёнными перегенерациями: обновляемся,
    // когда в чате добавилась сгенерированная картинка или сменился её src.
    const chat = document.getElementById('chat');
    if (chat) {
        const scheduleChatRefresh = () => {
            if (!overlay.isConnected || galleryState.scope !== 'chat') return;
            if (overlay._chatRefreshTimer) clearTimeout(overlay._chatRefreshTimer);
            overlay._chatRefreshTimer = setTimeout(() => {
                overlay._chatRefreshTimer = null;
                if (!overlay.isConnected || galleryState.scope !== 'chat') return;
                galleryState.images = collectChatImages();
                galleryState.selected.clear();
                clampGalleryPage();
                updateGallerySelectionUI(overlay);
                renderGalleryContent(bodyEl);
            }, 120);
        };
        overlay._chatObserver = new MutationObserver((mutations) => {
            const changed = mutations.some((mutation) => {
                if (mutation.type === 'attributes') {
                    return mutation.target instanceof HTMLImageElement
                        && mutation.target.matches('img[data-iig-instruction], img.iig-generated-image');
                }
                return Array.from(mutation.addedNodes).some((node) => node instanceof Element
                    && (node.matches?.('img[data-iig-instruction], img.iig-generated-image')
                        || node.querySelector?.('img[data-iig-instruction], img.iig-generated-image')));
            });
            if (changed) scheduleChatRefresh();
        });
        overlay._chatObserver.observe(chat, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src'],
        });
    }

    // Переключение скоупа (чат / все картинки персонажа)
    overlay.querySelectorAll('[data-gallery-scope]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const scope = btn.getAttribute('data-gallery-scope');
            if (scope === galleryState.scope) return;
            galleryState.scope = scope;
            galleryState.page = 0;
            galleryState.selected.clear();
            overlay.querySelectorAll('[data-gallery-scope]').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-gallery-scope') === galleryState.scope);
            });
            refreshGallery();
        });
    });

    // Сортировка
    overlay.querySelector('#iig_gallery_sort').addEventListener('change', (e) => {
        galleryState.sort = e.target.value;
        galleryState.page = 0;
        galleryState.selected.clear();
        updateGallerySelectionUI(overlay);
        renderGalleryContent(bodyEl);
    });

    // Кол-во на странице
    overlay.querySelector('#iig_gallery_perpage').addEventListener('change', (e) => {
        galleryState.perPage = parseInt(e.target.value, 10) || GALLERY_DEFAULT_PER_PAGE;
        galleryState.page = 0;
        galleryState.selected.clear();
        updateGallerySelectionUI(overlay);
        renderGalleryContent(bodyEl);
    });

    applyGalleryThumbSize(overlay);

    // Слайдер размера тумбнейлов
    overlay.querySelector('#iig_gallery_thumbsize_toggle').addEventListener('click', () => {
        galleryState.showThumbSlider = !galleryState.showThumbSlider;
        overlay.querySelector('#iig_gallery_thumbsize_toggle').classList.toggle('iig-gallery-btn-active', galleryState.showThumbSlider);
        const footerEl = overlay.querySelector('#iig_gallery_footer');
        if (footerEl) renderGalleryFooter(footerEl);
    });

    // Режим выбора
    overlay.querySelector('#iig_gallery_select_toggle').addEventListener('click', () => {
        galleryState.selectMode = !galleryState.selectMode;
        galleryState.selected.clear();
        updateGallerySelectionUI(overlay);
        renderGalleryContent(bodyEl);
    });

    // Выбрать все (на текущей странице)
    overlay.querySelector('#iig_gallery_select_all').addEventListener('click', () => {
        const pageImgs = getGalleryPageImages();
        const allOnPage = pageImgs.every((_, i) => galleryState.selected.has(galleryState.page * galleryState.perPage + i));
        if (allOnPage) {
            pageImgs.forEach((_, i) => galleryState.selected.delete(galleryState.page * galleryState.perPage + i));
        } else {
            pageImgs.forEach((_, i) => galleryState.selected.add(galleryState.page * galleryState.perPage + i));
        }
        updateGallerySelectionUI(overlay);
        renderGalleryContent(bodyEl);
    });

    // Скачать выбранные
    overlay.querySelector('#iig_gallery_download_selected').addEventListener('click', async () => {
        const selected = getSelectedGalleryImages();
        for (const img of selected) {
            await downloadGalleryImage(img);
        }
    });

    // Удалить выбранные
    overlay.querySelector('#iig_gallery_delete_selected').addEventListener('click', async () => {
        const selected = getSelectedGalleryImages();
        if (selected.length === 0) return;
        const confirmed = confirm(`Удалить выбранные (${selected.length})? Это действие необратимо.`);
        if (!confirmed) return;

        for (const img of selected) {
            await deleteGalleryImage(img);
        }

        await refreshGallery();
        toastr.success(`Удалено: ${selected.length}`, 'Галерея', { timeOut: 2000 });
    });

    refreshGallery();
    updateGalleryCount(overlay);
}

function getSelectedGalleryImages() {
    const sorted = getSortedGalleryImages();
    return Array.from(galleryState.selected)
        .sort((a, b) => b - a)
        .map(idx => sorted[idx])
        .filter(Boolean);
}

function updateGallerySelectionUI(overlay) {
    const toggleBtn = overlay.querySelector('#iig_gallery_select_toggle');
    const selectAllBtn = overlay.querySelector('#iig_gallery_select_all');
    const deleteBtn = overlay.querySelector('#iig_gallery_delete_selected');
    const downloadBtn = overlay.querySelector('#iig_gallery_download_selected');

    toggleBtn.classList.toggle('iig-gallery-btn-active', galleryState.selectMode);
    selectAllBtn.style.display = galleryState.selectMode ? '' : 'none';
    deleteBtn.style.display = galleryState.selectMode ? '' : 'none';
    downloadBtn.style.display = galleryState.selectMode ? '' : 'none';

    deleteBtn.disabled = galleryState.selected.size === 0;
    downloadBtn.disabled = galleryState.selected.size === 0;

    updateGalleryCount(overlay);
}

function updateGalleryCount(overlay) {
    const countEl = overlay.querySelector('#iig_gallery_count');
    if (!countEl) return;
    const total = galleryState.images.length;
    const selCount = galleryState.selected.size;
    if (galleryState.selectMode && selCount > 0) {
        countEl.textContent = `${selCount} / ${total}`;
    } else {
        countEl.textContent = `${total}`;
    }
}

// ── Отрисовка сетки и пагинации ──

function applyGalleryThumbSize(overlay) {
    overlay.style.setProperty('--iig-gallery-thumb-min', galleryState.thumbSize + 'px');
}

function renderGalleryContent(bodyEl) {
    clampGalleryPage();
    const sorted = getSortedGalleryImages();
    const overlay = document.getElementById(GALLERY_OVERLAY_ID);

    if (sorted.length === 0) {
        const emptyText = galleryState.scope === 'character'
            ? 'У этого персонажа нет сохранённых картинок'
            : 'В этом чате нет сгенерированных картинок';
        bodyEl.innerHTML = `<div class="iig-gallery-empty"><i class="fa-regular fa-image"></i><p>${emptyText}</p></div>`;
        if (overlay) renderGalleryFooter(overlay.querySelector('#iig_gallery_footer'));
        return;
    }

    const pageImages = getGalleryPageImages();
    const startIdx = galleryState.page * galleryState.perPage;

    const cardsHtml = pageImages.map((img, i) => {
        const globalIdx = startIdx + i;
        const isSelected = galleryState.selected.has(globalIdx);
        const promptShort = (img.prompt || '').slice(0, 80) + ((img.prompt || '').length > 80 ? '…' : '');

        // Одна строка мета поверх картинки: в чат-скоупе — № сообщения и имя,
        // в скоупе «Все» — имя файла. Полные данные — в title-тултипе.
        const metaLine = img.messageId !== null
            ? `#${img.messageId}${img.charName ? ' · ' + sanitizeForHtml(img.charName) : ''}`
            : sanitizeForHtml(img.filename);
        const tooltipParts = [];
        if (img.messageId !== null) tooltipParts.push(`Сообщение #${img.messageId}${img.charName ? ' · ' + img.charName : ''}`);
        if (img.filename) tooltipParts.push(img.filename);
        if (img.prompt) tooltipParts.push(img.prompt);
        const tooltip = sanitizeForHtml(tooltipParts.join('\n')).replace(/"/g, '&quot;');

        return `
            <div class="iig-gallery-card ${isSelected ? 'iig-gallery-card-selected' : ''}" data-gallery-idx="${globalIdx}" title="${tooltip}">
                <img class="iig-gallery-thumb" src="${sanitizeForHtml(img.src)}" alt="" loading="lazy">
                ${galleryState.selectMode ? `<div class="iig-gallery-checkbox ${isSelected ? 'checked' : ''}"><i class="fa-${isSelected ? 'solid fa-square-check' : 'regular fa-square'}"></i></div>` : ''}
                <div class="iig-gallery-card-actions">
                    <button class="iig-gallery-card-btn" data-gallery-action="download" data-gallery-idx="${globalIdx}" title="Скачать"><i class="fa-solid fa-download"></i></button>
                    <button class="iig-gallery-card-btn iig-gallery-card-btn-danger" data-gallery-action="delete" data-gallery-idx="${globalIdx}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="iig-gallery-card-meta">
                    <span class="iig-gallery-card-line">${metaLine}</span>
                    ${promptShort ? `<span class="iig-gallery-card-prompt">${sanitizeForHtml(promptShort)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    bodyEl.innerHTML = `<div class="iig-gallery-grid">${cardsHtml}</div>`;

    if (overlay) {
        applyGalleryThumbSize(overlay);
        renderGalleryFooter(overlay.querySelector('#iig_gallery_footer'));
    }

    bodyEl.removeEventListener('click', handleGalleryBodyClick);
    bodyEl.addEventListener('click', handleGalleryBodyClick);
}

function renderGalleryFooter(footerEl) {
    if (!footerEl) return;
    const paginationHtml = buildGalleryPaginationHtml();
    const thumbSliderHtml = galleryState.showThumbSlider ? `
        <div class="iig-gallery-thumb-size-wrap">
            <i class="fa-solid fa-image" style="font-size:10px;opacity:0.5"></i>
            <input type="range" class="iig-gallery-thumb-slider" id="iig_gallery_thumb_size"
                min="${GALLERY_THUMB_SIZE_OPTIONS[0]}" max="${GALLERY_THUMB_SIZE_OPTIONS[GALLERY_THUMB_SIZE_OPTIONS.length - 1]}"
                step="10" value="${galleryState.thumbSize}">
            <i class="fa-solid fa-image" style="font-size:16px;opacity:0.5"></i>
        </div>
    ` : '';
    const hasContent = paginationHtml || thumbSliderHtml;
    footerEl.innerHTML = hasContent ? `<div class="iig-gallery-footer-row">${paginationHtml}${thumbSliderHtml}</div>` : '';
    footerEl.style.display = hasContent ? '' : 'none';
    const slider = footerEl.querySelector('#iig_gallery_thumb_size');
    if (slider) {
        slider.addEventListener('input', (e) => {
            galleryState.thumbSize = parseInt(e.target.value, 10) || GALLERY_DEFAULT_THUMB_SIZE;
            const overlay = document.getElementById(GALLERY_OVERLAY_ID);
            if (overlay) applyGalleryThumbSize(overlay);
        });
    }
    footerEl.removeEventListener('click', handleGalleryBodyClick);
    footerEl.addEventListener('click', handleGalleryBodyClick);
}

function buildGalleryPaginationHtml() {
    const totalPages = getGalleryTotalPages();
    if (totalPages <= 1) return '';

    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        if (totalPages > 7) {
            const show = i === 0 || i === totalPages - 1
                || (i >= galleryState.page - 1 && i <= galleryState.page + 1);
            if (!show) {
                if (pages.length && pages[pages.length - 1] !== '…') pages.push('…');
                continue;
            }
        }
        pages.push(i);
    }

    const btns = pages.map(p => {
        if (p === '…') return `<span class="iig-gallery-page-ellipsis">…</span>`;
        return `<button class="iig-gallery-page-btn ${p === galleryState.page ? 'active' : ''}" data-gallery-page="${p}" type="button">${p + 1}</button>`;
    }).join('');

    return `
        <div class="iig-gallery-pagination">
            <button class="iig-gallery-page-btn" data-gallery-page-prev type="button" ${galleryState.page <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
            ${btns}
            <button class="iig-gallery-page-btn" data-gallery-page-next type="button" ${galleryState.page >= totalPages - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
        </div>
    `;
}

// ── Делегированный обработчик кликов ──

function handleGalleryBodyClick(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    // Пагинация
    const pageBtn = target.closest('[data-gallery-page]');
    if (pageBtn) {
        galleryState.page = parseInt(pageBtn.getAttribute('data-gallery-page'), 10);
        galleryState.selected.clear();
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateGallerySelectionUI(overlay);
        if (bodyEl) renderGalleryContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    if (target.closest('[data-gallery-page-prev]')) {
        if (galleryState.page > 0) { galleryState.page--; galleryState.selected.clear(); }
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateGallerySelectionUI(overlay);
        if (bodyEl) renderGalleryContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    if (target.closest('[data-gallery-page-next]')) {
        if (galleryState.page < getGalleryTotalPages() - 1) { galleryState.page++; galleryState.selected.clear(); }
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateGallerySelectionUI(overlay);
        if (bodyEl) renderGalleryContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // Кнопки действий на карточке
    const actionBtn = target.closest('[data-gallery-action]');
    if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-gallery-action');
        const idx = parseInt(actionBtn.getAttribute('data-gallery-idx'), 10);
        const sorted = getSortedGalleryImages();
        const img = sorted[idx];
        if (!img) return;

        if (action === 'download') {
            downloadGalleryImage(img);
        } else if (action === 'delete') {
            handleGallerySingleDelete(idx);
        }
        return;
    }

    // Клик по карточке — выбор или просмотр
    const card = target.closest('.iig-gallery-card[data-gallery-idx]');
    if (card) {
        const idx = parseInt(card.getAttribute('data-gallery-idx'), 10);
        if (galleryState.selectMode) {
            if (galleryState.selected.has(idx)) galleryState.selected.delete(idx);
            else galleryState.selected.add(idx);
            const overlay = document.getElementById(GALLERY_OVERLAY_ID);
            const bodyEl = overlay?.querySelector('#iig_gallery_body');
            if (overlay) updateGallerySelectionUI(overlay);
            if (bodyEl) renderGalleryContent(bodyEl);
        } else {
            openGalleryViewer(idx);
        }
    }
}

// ── Удаление одной картинки ──

async function handleGallerySingleDelete(idx) {
    const sorted = getSortedGalleryImages();
    const img = sorted[idx];
    if (!img) return;
    const confirmText = img.messageId === null
        ? 'Удалить этот файл с диска? Действие необратимо.'
        : 'Удалить эту картинку из чата?';
    const confirmed = confirm(confirmText);
    if (!confirmed) return;

    await deleteGalleryImage(img);
    await refreshGallery();
    toastr.success('Картинка удалена', 'Галерея', { timeOut: 2000 });
}

async function deleteGalleryImage(img) {
    if (img.messageId === null) {
        await deleteGalleryImageFile(img);
    } else {
        await deleteGalleryImageFromChat(img);
    }
}

// ── Просмотр из галереи (фуллскрин-вьюер) ──

function restoreGalleryWhenViewerCloses(overlay) {
    const viewer = document.getElementById('iig-fullscreen-overlay');
    if (!viewer) {
        if (overlay) overlay.style.display = '';
        return;
    }
    const observer = new MutationObserver(() => {
        if (!document.getElementById('iig-fullscreen-overlay')) {
            observer.disconnect();
            if (overlay) overlay.style.display = '';
        }
    });
    observer.observe(document.body, { childList: true });
}

function openGalleryViewer(idx) {
    const sorted = getSortedGalleryImages();
    const img = sorted[idx];
    if (!img) return;

    const overlay = document.getElementById(GALLERY_OVERLAY_ID);
    if (overlay) overlay.style.display = 'none';

    openFullscreenViewer(img.src);
    restoreGalleryWhenViewerCloses(overlay);
}

// ── Скачивание ──

async function downloadGalleryImage(img) {
    await iigDownloadImage(img.src, img.filename || '');
}

// ── Удаление картинки из сообщения чата ──

async function deleteGalleryImageFromChat(img) {
    const context = SillyTavern.getContext();
    const message = context.chat[img.messageId];
    if (!message) return;

    // В message.mes src хранится относительным путём ("user/images/...") без
    // percent-encoding, а DOM img.src — абсолютный закодированный URL.
    // Матчим все варианты записи.
    const variants = new Set([img.src]);
    if (!img.src.startsWith('data:')) {
        try {
            const pathname = new URL(img.src, location.origin).pathname;
            const decoded = decodeURIComponent(pathname);
            for (const p of [pathname, decoded]) {
                variants.add(p);
                variants.add(p.replace(/^\//, ''));
            }
        } catch { /* оставляем только абсолютный src */ }
    }
    const srcPattern = Array.from(variants).map(iigEscapeRegex).join('|');
    const imgTagRegex = new RegExp(
        `<img\\s[^>]*src\\s*=\\s*["'](?:${srcPattern})["'][^>]*>`,
        'i',
    );
    // Legacy-маркер завершённой генерации [IMG:✓:src]
    const legacyMarkerRegex = new RegExp(`\\[IMG:✓:(?:${srcPattern})\\]`, 'i');

    const stripTag = (text) => String(text).replace(imgTagRegex, '').replace(legacyMarkerRegex, '');
    if (message.mes) message.mes = stripTag(message.mes);
    if (message.extra?.display_text) message.extra.display_text = stripTag(message.extra.display_text);
    if (message.extra?.extblocks) message.extra.extblocks = stripTag(message.extra.extblocks);

    // Зеркала текущего свайпа — иначе картинка «воскресает» после свайпа туда-обратно
    const swipeId = message.swipe_id;
    if (swipeId !== undefined) {
        if (Array.isArray(message.swipes) && typeof message.swipes[swipeId] === 'string') {
            message.swipes[swipeId] = stripTag(message.swipes[swipeId]);
        }
        const swipeExtra = message.swipe_info?.[swipeId]?.extra;
        if (swipeExtra?.extblocks) swipeExtra.extblocks = stripTag(swipeExtra.extblocks);
        if (swipeExtra?.display_text) swipeExtra.display_text = stripTag(swipeExtra.display_text);
    }

    rerenderMessageFromSource(img.messageId);

    await context.saveChat();

    if (img.src && !img.src.startsWith('data:')) {
        try {
            const path = img.src.startsWith('/') ? img.src : new URL(img.src, location.origin).pathname;
            await fetch('/api/images/delete', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ path }),
            });
        } catch (err) {
            iigLog('WARN', 'Gallery: failed to delete image file:', err);
        }
    }
}

// ── Удаление файла картинки с диска (скоуп «Все») ──

async function deleteGalleryImageFile(img) {
    if (!img.diskPath) return;
    const context = SillyTavern.getContext();
    try {
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ path: img.diskPath }),
        });
    } catch (err) {
        iigLog('WARN', 'Gallery: failed to delete image file:', err);
    }
}

// ── Пункт «Галерея чата» в меню «волшебной палочки» ──

function ensureGalleryWandButton() {
    const settings = getSettings();
    const show = settings.enabled !== false;
    // Свой id (не iig_gallery_wand_button): если рядом установлен novarakk — не конфликтуем.
    let item = document.getElementById('iig_si_gallery_wand');
    if (!show) { if (item) item.remove(); return; }
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return; // меню ещё не построено — повторим на APP_READY/CHAT_CHANGED
    if (!item) {
        item = document.createElement('div');
        item.id = 'iig_si_gallery_wand';
        item.className = 'list-group-item flex-container flexGap5';
        item.title = 'Все сгенерированные картинки чата и персонажа: просмотр, скачивание, удаление';
        item.addEventListener('click', () => openGallery());
        item.innerHTML = '<div class="fa-solid fa-images extensionsMenuExtensionButton"></div><span>Галерея чата</span>';
        menu.appendChild(item);
    }
}

/**
 * Кнопка «Скачать» во вьюере штатной галереи ST.
 * Галерея открывает картинку в draggable-окне (.galleryImageDraggable в #movingDivs),
 * откуда оригинал не вытащить по-человечески (drag заблокирован, на мобильных — только скриншот).
 * Подсаживаем иконку скачивания в шапку окна через MutationObserver — ядро ST не трогаем.
 */
function initGalleryDownloadButton() {
    const container = document.getElementById('movingDivs');
    if (!container || container.dataset.iigDownloadObserver) return;
    container.dataset.iigDownloadObserver = '1';

    const inject = (node) => {
        if (!(node instanceof HTMLElement) || !node.classList?.contains('galleryImageDraggable')) return;
        const bar = node.querySelector('.panelControlBar');
        if (!bar || bar.querySelector('.iig-drag-download')) return;
        const btn = document.createElement('div');
        btn.className = 'fa-fw fa-solid fa-download iig-drag-download';
        btn.title = 'Скачать оригинал';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const src = node.querySelector('img')?.getAttribute('src')
                || node.querySelector('video')?.getAttribute('src') || '';
            if (src) iigDownloadImage(src);
        });
        bar.insertBefore(btn, bar.querySelector('.dragClose'));
    };

    for (const el of container.querySelectorAll('.galleryImageDraggable')) inject(el);
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) inject(node);
        }
    });
    observer.observe(container, { childList: true });
}

/**
 * Initialize extension
 */
(function init() {
    const context = SillyTavern.getContext();

    // Load settings, init lorebooks, and restore refs
    getSettings();
    ensureLorebooks();
    registerIigBookMacro();
    restoreRefsFromLocalStorage();
    initMobileSaveListeners();
    
    // Initialize global click handler (event delegation — survives DOM re-renders)
    initGlobalClickHandler();

    // Кнопка «Скачать оригинал» во вьюере штатной галереи ST
    initGalleryDownloadButton();
    
    // Create settings UI when app is ready
    context.eventSource.on(context.event_types.APP_READY, () => {
        createSettingsUI();
        // Add buttons to any messages already in chat
        addButtonsToExistingMessages();
        try { applyImgActionButtonClasses(); } catch (e) {}
        try { updateAvatarAppearanceInjection(); } catch (e) {}
        try { ensureHistoryPicWandButton(); } catch (e) {}
        try { ensureGalleryWandButton(); } catch (e) {}
        // Повтор на случай, если #movingDivs ещё не существовал при загрузке модуля
        try { initGalleryDownloadButton(); } catch (e) {}
    });
    
    // When chat is loaded/changed, add buttons to all existing messages
    context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            addButtonsToExistingMessages();
            // Сменился чат → редактор внешности {{user}} снова показывает АКТИВНУЮ персону.
            iigUserDescPersona = null;
            // Перечитываем внешность/фото под нового персонажа/персону (если панель настроек открыта).
            try { renderRefSlots(); bindRefSlotEvents(); } catch (e) { iigLog('WARN', 'per-char UI refresh failed:', e.message); }
            // Обновляем инъекцию внешности аватаров в LLM-контекст под новый чат.
            try { updateAvatarAppearanceInjection(); } catch (e) {}
            try { ensureHistoryPicWandButton(); } catch (e) {}
            try { ensureGalleryWandButton(); } catch (e) {}
        }, 100);
    });

    // Listen for new messages AFTER they're rendered in DOM
    // CHARACTER_MESSAGE_RENDERED fires after addOneMessage() completes
    context.eventSource.makeLast(context.event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
    
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

    // Ре-рендер сообщения (редактирование, обновление) уничтожает обёртки с кнопками —
    // навешиваем заново, иначе картинку потом «нельзя перегенерить».
    for (const evName of ['MESSAGE_EDITED', 'MESSAGE_UPDATED']) {
        const evType = context.event_types[evName];
        if (!evType) continue;
        context.eventSource.on(evType, (messageId) => {
            setTimeout(() => {
                const el = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                if (!el) return;
                const msg = context.chat[messageId];
                if (msg && !msg.is_user) {
                    addRegenerateButton(el, messageId);
                    try { restoreHistoryPicMessageDom(messageId); } catch (_) {}
                    const mesText = el.querySelector('.mes_text');
                    if (mesText) enhanceRenderedImages(mesText, messageId);
                }
            }, 100);
        });
    }

    // Safety net: MutationObserver re-adds buttons if DOM is rebuilt for any reason.
    // NOTE: subtree:false — `.mes` elements are always direct children of `#chat`.
    // Watching the subtree triggers on every streaming token (huge perf cost).
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (!node.classList?.contains('mes')) continue;
                    const mesId = node.getAttribute('mesid');
                    if (mesId === null) continue;
                    const id = parseInt(mesId, 10);
                    const msg = context.chat[id];
                    if (msg && !msg.is_user && !node.querySelector('.iig-regenerate-btn')) {
                        addRegenerateButton(node, id);
                    }
                }
            }
        });
        observer.observe(chatEl, { childList: true, subtree: false });
    }
    
    console.log('[IIG] Inline Image Generation extension initialized');
})();
