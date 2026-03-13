# SillyWardrobe — Гардероб для SillyTavern

Расширение добавляет систему аутфитов для бота и юзера. Загружай картинки одежды, выбирай активный аутфит — он автоматически отправляется как reference-изображение при генерации картинок через sillyimages.

## Фичи

- **Кнопка-гардероб** рядом с аватаром персонажа (с индикатором активного аутфита)
- **Два таба**: Бот / Юзер — раздельные коллекции одежды
- **Per-chat активация**: в каждом чате свой активный аутфит
- **Per-character коллекция**: у каждого персонажа своя одежда (shared across chats)
- **Интеграция с sillyimages**: активный аутфит → reference image при генерации
- **Glassmorphism UI** с приятными гlow-эффектами

## Установка

### 1. SillyWardrobe (расширение гардероба)

Скопируй папку `sillywardrobe` в:
```
SillyTavern/public/scripts/extensions/third-party/sillywardrobe/
```

Файлы:
```
sillywardrobe/
├── manifest.json
├── index.js
├── style.css
└── (README.md, INTEGRATION_PATCH.js — справочные, не обязательны)
```

### 2. Патч sillyimages (интеграция)

Замени файл `index.js` в своём форке sillyimages на `sillyimages_patched_index.js`:
```
SillyTavern/public/scripts/extensions/third-party/sillyimages/index.js
```

Или примени патч вручную — см. `INTEGRATION_PATCH.js` для точного описания.

### 3. Перезапусти SillyTavern

## Использование

1. Открой чат с персонажем
2. Нажми на иконку 👕 рядом с аватаром (или в top bar)
3. Выбери таб (Бот / Юзер)
4. Загрузи картинки аутфитов (jpg/png/webp)
5. Кликни на аутфит или нажми toggle чтобы активировать
6. Зелёный глоу = активно, точка на кнопке = что-то надето
7. При генерации картинок через sillyimages активные аутфиты автоматически идут как reference

## Public API

Для кастомных интеграций, расширение выставляет `window.sillyWardrobe`:

```js
// Получить base64 активного аутфита (без data: префикса)
window.sillyWardrobe.getActiveOutfitBase64('bot')  // string | null
window.sillyWardrobe.getActiveOutfitBase64('user') // string | null

// Получить как data URL (для Naistera и подобных)
window.sillyWardrobe.getActiveOutfitDataUrl('bot')  // "data:image/jpeg;base64,..." | null

// Получить полный объект { id, name, description, base64, addedAt }
window.sillyWardrobe.getActiveOutfitData('bot')

// Проверить что расширение загружено
window.sillyWardrobe.isReady() // true
```

## Настройки

В панели Extensions → Гардероб:
- **Макс. размер (px)**: максимальная сторона сохраняемого изображения (default: 512)
- **Качество JPEG**: сжатие при сохранении (default: 0.80)
- **Очистить всё**: удалить все аутфиты для всех персонажей

## Хранение

- Аутфиты хранятся как base64 в `extensionSettings` (settings.json)
- Активный аутфит per-chat — в `chat_metadata`
- При ~512px / 0.8 quality одна картинка ≈ 20-40KB base64
