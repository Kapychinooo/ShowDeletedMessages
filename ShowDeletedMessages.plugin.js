/**
 * @name ShowDeletedMessages
 * @author Kapychinooo
 * @description Показывает удалённые сообщения в каналах Discord
 * @version 1.1.1
 */
// @ts-nocheck
"use strict";

module.exports = class ShowDeletedMessages {
    constructor() {
        this.cache        = new Map(); // messageId -> { content, attachments }
        this.deleted      = new Set(); // ids удалённых сообщений
        this._pending     = new Map(); // id -> данные для немедленного восстановления
        this._deletedData = new Map(); // id -> постоянные данные (headerHTML, imgSrc, channelId, cached)
    }

    getName()        { return "ShowDeletedMessages"; }
    getDescription() { return "Показывает удалённые сообщения и изображения."; }
    getVersion()     { return "1.1.1"; }
    getAuthor()      { return "Kapychinooo"; }

    start() {
        this.log("start v10");
        this.injectCSS();
        this.interceptXHR();
        this.hookDispatcher();
        this.startDOMObserver();
        try { BdApi.UI.showToast("ShowDeletedMessages v10 ✓", { type: "success" }); }
        catch (_) { BdApi.showToast?.("ShowDeletedMessages v10 ✓", { type: "success" }); }
    }

    stop() {
        BdApi.Patcher.unpatchAll("ShowDeletedMessages");
        if (window.__sdmOriginalXHROpen) {
            XMLHttpRequest.prototype.open = window.__sdmOriginalXHROpen;
            delete window.__sdmOriginalXHROpen;
        }
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        try { BdApi.DOM.removeStyle("ShowDeletedMessages"); }
        catch (_) { BdApi.clearCSS?.("ShowDeletedMessages"); }
        document.querySelectorAll(".sdm-deleted-wrap").forEach(n => n.remove());
        this.cache.clear();
        this.deleted.clear();
        this._pending.clear();
        this._deletedData.clear();
        try { BdApi.UI.showToast("ShowDeletedMessages выключен", { type: "info" }); }
        catch (_) { BdApi.showToast?.("ShowDeletedMessages выключен", { type: "info" }); }
    }

    // =========================================================================
    // Dispatcher
    // =========================================================================

    hookDispatcher() {
        const dispatcher = this.getDispatcher();
        if (!dispatcher) { this.log("Dispatcher не найден", "error"); return; }
        this.log("Dispatcher найден ✓");
        this.dispatcher = dispatcher;

        dispatcher.subscribe("MESSAGE_CREATE", ({ message }) => {
            if (message) this.cacheMsg(message);
        });
        dispatcher.subscribe("MESSAGE_UPDATE", ({ message }) => {
            if (message) this.cacheMsg(message);
        });
        dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", (p) => {
            const list = p?.messages;
            if (!list) return;
            (Array.isArray(list) ? list : Object.values(list)).forEach(m => m && this.cacheMsg(m));
            // После загрузки канала восстанавливаем удалённые сообщения
            setTimeout(() => this.restoreInChannel(p?.channelId), 400);
        });
        dispatcher.subscribe("CHANNEL_SELECT", () => {
            setTimeout(() => this.restoreAllVisible(), 600);
        });

        // BEFORE — захватываем данные пока элемент ещё в DOM
        BdApi.Patcher.before("ShowDeletedMessages", dispatcher, "dispatch", (_, [action]) => {
            if (!action) return;
            if (action.type === "MESSAGE_DELETE") {
                this.captureMessage(action.id, action.channelId);
            } else if (action.type === "MESSAGE_DELETE_BULK") {
                (action.ids || []).forEach(id => this.captureMessage(id, action.channelId));
            }
        });

        // AFTER — Discord убрал элемент, вставляем наш
        BdApi.Patcher.after("ShowDeletedMessages", dispatcher, "dispatch", (_, [action]) => {
            if (!action) return;
            if (action.type === "MESSAGE_DELETE") {
                this.restoreFromPending(action.id);
            } else if (action.type === "MESSAGE_DELETE_BULK") {
                (action.ids || []).forEach(id => this.restoreFromPending(id));
            }
        });

        this.log("Dispatcher пропатчен ✓");
    }

    getDispatcher() {
        const MessageStore =
            BdApi.Webpack.getStore?.("MessageStore") ||
            BdApi.Webpack.getByStoreName?.("MessageStore") ||
            BdApi.Webpack.getByKeys?.("getMessage", "getMessages");

        if (MessageStore?._dispatcher) return MessageStore._dispatcher;
        if (MessageStore?.dispatcher)  return MessageStore.dispatcher;

        const candidates = [
            () => BdApi.Webpack.getByKeys?.("dispatch", "subscribe", "unsubscribe"),
            () => BdApi.Webpack.getByKeys?.("dispatch", "register", "waitFor"),
            () => BdApi.Webpack.getModule?.(m =>
                typeof m?.dispatch === "function" &&
                typeof m?.subscribe === "function" &&
                typeof m?.waitFor === "function"
            ),
        ];
        for (const fn of candidates) {
            try { const d = fn(); if (d?.subscribe) return d; } catch(_) {}
        }
        return null;
    }

    // =========================================================================
    // Захват и восстановление
    // =========================================================================

    captureMessage(id, channelId) {
        if (!this.cache.has(id) || this.deleted.has(id)) return;
        this.deleted.add(id);

        const el         = this.findMsgEl(id, channelId);
        // Ищем заголовок — может быть в этом элементе или в предыдущем (сгруппированные сообщения)
        let headerHTML = el?.querySelector('[class*="header"]')?.outerHTML || "";
        let imgSrc     = el?.querySelector('img[class*="avatar"]')?.src || "";

        // Если это сгруппированное сообщение (нет header) — ищем выше по DOM
        if (!headerHTML && el) {
            let prev = el.previousElementSibling;
            while (prev) {
                const h = prev.querySelector('[class*="header"]');
                if (h) { headerHTML = h.outerHTML; imgSrc = prev.querySelector('img[class*="avatar"]')?.src || ""; break; }
                prev = prev.previousElementSibling;
            }
        }

        const cached = this.cache.get(id);

        // Постоянное хранилище
        this._deletedData.set(id, { channelId, headerHTML, imgSrc, cached });

        if (el) {
            this._pending.set(id, {
                parent:      el.parentElement,
                nextSibling: el.nextSibling,
            });
        }
        this.log(`Захвачено: ${id}`);
    }

    // Восстанавливаем сразу после удаления (элемент был в DOM)
    restoreFromPending(id) {
        const pending = this._pending.get(id);
        if (!pending) return;
        this._pending.delete(id);

        const data = this._deletedData.get(id);
        if (!data) return;

        setTimeout(() => {
            if (document.querySelector(`[data-sdm-id="${id}"]`)) return;
            const { parent, nextSibling } = pending;
            if (!document.contains(parent)) return;
            const wrap = this.buildEl(id, data);
            if (nextSibling && document.contains(nextSibling)) {
                parent.insertBefore(wrap, nextSibling);
            } else {
                parent.appendChild(wrap);
            }
            this.log(`Вставлено: ${id} ✓`);
        }, 80);
    }

    // Восстанавливаем в конкретном канале после загрузки истории
    restoreInChannel(channelId) {
        if (!channelId) return;
        for (const [id, data] of this._deletedData) {
            if (data.channelId !== channelId) continue;
            if (document.querySelector(`[data-sdm-id="${id}"]`)) continue;
            this.insertByTimestamp(id, data);
        }
    }

    // Восстанавливаем все видимые удалённые сообщения
    restoreAllVisible() {
        for (const [id, data] of this._deletedData) {
            if (document.querySelector(`[data-sdm-id="${id}"]`)) continue;
            const neighbor = document.querySelector(`[id*="chat-messages-${data.channelId}-"]`);
            if (!neighbor) continue;
            this.insertByTimestamp(id, data);
        }
    }

    // Вставляем в правильное хронологическое место по snowflake ID
    insertByTimestamp(id, data) {
        if (document.querySelector(`[data-sdm-id="${id}"]`)) return;
        const msgId = BigInt(id);
        let insertBefore = null;
        let container    = null;

        for (const el of document.querySelectorAll('[id^="chat-messages-"]')) {
            const m = el.id.match(/chat-messages-[^-]+-(\d+)$/);
            if (!m) continue;
            try {
                const elId = BigInt(m[1]);
                if (elId > msgId) {
                    if (!insertBefore) { insertBefore = el; container = el.parentElement; }
                    break;
                }
                container = el.parentElement;
            } catch(_) {}
        }

        if (!container) return;
        const wrap = this.buildEl(id, data);
        if (insertBefore && document.contains(insertBefore)) {
            container.insertBefore(wrap, insertBefore);
        } else {
            container.appendChild(wrap);
        }
        this.log(`Восстановлено (переход): ${id} ✓`);
    }

    buildEl(id, data) {
        const { headerHTML, imgSrc, cached } = data;
        const wrap = document.createElement("div");
        wrap.className = "sdm-deleted-wrap";
        wrap.dataset.sdmId = id;
        wrap.innerHTML = `
            <div class="sdm-deleted-inner">
                ${imgSrc ? `<img class="sdm-avatar" src="${this.escapeHTML(imgSrc)}" alt="">` : ""}
                <div class="sdm-body">
                    <div class="sdm-header">${headerHTML}<span class="sdm-badge">удалено</span></div>
                    <div class="sdm-content">${this.escapeHTML(cached?.content || "")}</div>
                    ${cached?.attachments?.length
                        ? `<div class="sdm-attach">${this.formatAttachments(cached.attachments)}</div>`
                        : ""}
                </div>
            </div>`;
        return wrap;
    }

    // =========================================================================
    // XHR
    // =========================================================================

    interceptXHR() {
        if (window.__sdmOriginalXHROpen) return;
        const self = this;
        const orig = XMLHttpRequest.prototype.open;
        window.__sdmOriginalXHROpen = orig;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (typeof url === "string" && url.includes("/messages")) {
                this.addEventListener("load", function() {
                    try {
                        if (this.status !== 200) return;
                        const data = JSON.parse(this.responseText);
                        (Array.isArray(data) ? data : [data]).forEach(m => self.cacheMsg(m));
                    } catch(_) {}
                });
            }
            return orig.call(this, method, url, ...rest);
        };
        this.log("XHR перехват установлен ✓");
    }

    // =========================================================================
    // MutationObserver
    // =========================================================================

    startDOMObserver() {
        this._observer = new MutationObserver(mutations => {
            for (const mut of mutations) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    this.tryExtractFromFiber(node);
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
        this.log("MutationObserver запущен ✓");
    }

    tryExtractFromFiber(node) {
        try {
            const key = Object.keys(node).find(k =>
                k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")
            );
            if (!key) return;
            let fiber = node[key];
            for (let i = 0; i < 30 && fiber; i++) {
                const msg = fiber?.memoizedProps?.message || fiber?.pendingProps?.message;
                if (msg?.id && msg.content !== undefined) { this.cacheMsg(msg); return; }
                fiber = fiber.return;
            }
        } catch(_) {}
    }

    // =========================================================================
    // Кэш
    // =========================================================================

    cacheMsg(msg) {
        if (!msg?.id) return;
        const attachments = (msg.attachments ?? []).map(a => ({
            name: a.filename || a.url?.split("/").pop() || "файл",
            url:  a.url || a.proxy_url || "",
            type: a.content_type || (a.filename?.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? "image/" : ""),
        }));
        this.cache.set(msg.id, {
            content:     msg.content ?? "",
            attachments,
        });
    }

    findMsgEl(id, channelId) {
        return (
            document.querySelector(`[id="chat-messages-${channelId}-${id}"]`) ||
            document.querySelector(`[id*="${id}"]`) ||
            document.querySelector(`[data-message-id="${id}"]`)
        );
    }

    formatAttachments(attachments) {
        const parts = [];
        for (const a of attachments) {
            if (a.type?.startsWith("image/") && a.url) {
                parts.push(`<img class="sdm-img" src="${this.escapeHTML(a.url)}" alt="${this.escapeHTML(a.name)}">`);
            } else if (a.url) {
                parts.push(`<div class="sdm-attach-file">📎 <a href="${this.escapeHTML(a.url)}" target="_blank">${this.escapeHTML(a.name)}</a></div>`);
            }
        }
        return parts.join("");
    }

    escapeHTML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // =========================================================================
    // CSS
    // =========================================================================

    injectCSS() {
        const css = `
            .sdm-deleted-wrap {
                padding: 2px 16px 4px 72px;
                margin: 1px 0;
                background: rgba(237,66,69,.06);
                border-left: 3px solid #ed4245;
                position: relative;
                min-height: 44px;
                box-sizing: border-box;
            }
            .sdm-deleted-inner {
                display: flex;
                gap: 12px;
                align-items: flex-start;
            }
            .sdm-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                position: absolute;
                left: 16px;
                top: 4px;
                flex-shrink: 0;
            }
            .sdm-body {
                flex: 1;
                min-width: 0;
            }
            .sdm-header {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 4px;
                margin-bottom: 2px;
                font-size: 1rem;
                line-height: 1.375;
            }
            .sdm-header * {
                display: inline !important;
                visibility: visible !important;
            }
            .sdm-badge {
                display: inline-block !important;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .5px;
                color: #ed4245;
                background: rgba(237,66,69,.15);
                border: 1px solid rgba(237,66,69,.35);
                border-radius: 3px;
                padding: 1px 5px;
                margin-left: 4px;
                vertical-align: middle;
                pointer-events: none;
                user-select: none;
                line-height: 1.4;
            }
            .sdm-content {
                color: var(--text-muted);
                font-size: 1rem;
                line-height: 1.375;
                word-break: break-word;
                white-space: pre-wrap;
            }
            .sdm-attach-file {
                font-size: 12px;
                color: #ed4245;
                margin-top: 2px;
                font-style: italic;
            }
            .sdm-img {
                display: block;
                max-width: 400px;
                max-height: 300px;
                border-radius: 4px;
                margin-top: 6px;
                cursor: pointer;
                object-fit: contain;
            }
        `;
        try { BdApi.DOM.addStyle("ShowDeletedMessages", css); }
        catch (_) { BdApi.injectCSS?.("ShowDeletedMessages", css); }
    }

    // =========================================================================
    // Util
    // =========================================================================

    log(msg, level = "log") {
        console[level](`%c[ShowDeletedMessages]%c ${msg}`,
            "color:#ed4245;font-weight:bold", "color:inherit");
    }
};
