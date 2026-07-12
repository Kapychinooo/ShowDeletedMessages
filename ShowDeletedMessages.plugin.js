/**
 * @name ShowDeletedMessages
 * @description Показывает удалённые сообщения.
 * @version 2.0.2
 * @author Kapychinooo
 */
// @ts-nocheck
"use strict";

module.exports = class ShowDeletedMessages {
    constructor() {
        this.cache = new Map();
        this.deleted = new Map();
        this.styleEl = null;
        this._observer = null;
        this._interval = null;
    }

    getName()        { return "ShowDeletedMessages"; }
    getDescription() { return "Показывает удалённые сообщения."; }
    getVersion()     { return "2.0.2"; }
    getAuthor()      { return "Kapychinooo"; }

    start() {
        this.loadDeleted();
        this.injectCSS();
        this.hook();
        this.startObserver();
        var self = this;
        this.reTintAll();
        setTimeout(function() { self.reTintAll(); }, 500);
        setTimeout(function() { self.reTintAll(); }, 2000);
        this._interval = setInterval(function() { self.reTintAll(); }, 2000);
        BdApi.UI.showToast("ShowDeletedMessages v2.0.2", { type: "success" });
    }

    stop() {
        BdApi.Patcher.unpatchAll("SDM2");
        this.firePendingDeletes();
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        if (this.styleEl) { this.styleEl.remove(); this.styleEl = null; }
        document.querySelectorAll(".rdm-del").forEach(function(e) { e.classList.remove("rdm-del"); });
    }

    firePendingDeletes() {
        if (this.deleted.size === 0) return;
        var dispatcher = null;
        try {
            var MS = BdApi.Webpack.getStore("MessageStore");
            if (MS && MS._dispatcher) dispatcher = MS._dispatcher;
            if (!dispatcher && MS && MS.dispatcher) dispatcher = MS.dispatcher;
        } catch(e) {}
        if (!dispatcher) {
            try {
                dispatcher = BdApi.Webpack.getModule(function(m) {
                    return m && typeof m.dispatch === "function";
                });
            } catch(e) {}
        }
        if (!dispatcher) return;

        var channelMap = {};
        this.deleted.forEach(function(channelId, id) {
            if (!channelMap[channelId]) channelMap[channelId] = [];
            channelMap[channelId].push(id);
        });

        var self = this;
        Object.keys(channelMap).forEach(function(channelId) {
            var ids = channelMap[channelId];
            if (ids.length === 1) {
                dispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    channelId: channelId,
                    id: ids[0]
                });
            } else {
                dispatcher.dispatch({
                    type: "MESSAGE_DELETE_BULK",
                    channelId: channelId,
                    ids: ids
                });
            }
        });

        this.deleted.clear();
        this.saveDeleted();
    }

    hook() {
        var self = this;
        var dispatcher = null;

        try {
            var MS = BdApi.Webpack.getStore("MessageStore");
            if (MS && MS._dispatcher) dispatcher = MS._dispatcher;
            if (!dispatcher && MS && MS.dispatcher) dispatcher = MS.dispatcher;
        } catch(e) {}

        if (!dispatcher) {
            try {
                dispatcher = BdApi.Webpack.getModule(function(m) {
                    return m && typeof m.dispatch === "function" && typeof m.subscribe === "function";
                });
            } catch(e) {}
        }

        if (!dispatcher) {
            try {
                dispatcher = BdApi.Webpack.getModule(function(m) {
                    return m && typeof m.dispatch === "function" && typeof m.register === "function";
                });
            } catch(e) {}
        }

        if (!dispatcher) { console.log("[RDM] Dispatcher not found"); return; }
        console.log("[RDM] Dispatcher found");

        BdApi.Patcher.instead("SDM2", dispatcher, "dispatch", function(_, args, original) {
            var action = args[0];
            if (!action) return original.apply(this, args);

            try {
                if (action.type === "MESSAGE_CREATE" || action.type === "MESSAGE_UPDATE") {
                    if (action.message && action.message.id) {
                        self.cache.set(action.message.id, JSON.parse(JSON.stringify(action.message)));
                    }
                }

                if (action.type === "LOAD_MESSAGES_SUCCESS") {
                    var msgs = action.messages;
                    if (msgs && msgs.length) {
                        for (var i = 0; i < msgs.length; i++) {
                            if (msgs[i] && msgs[i].id) {
                                self.cache.set(msgs[i].id, JSON.parse(JSON.stringify(msgs[i])));
                            }
                        }
                    }
                }

                if (action.type === "MESSAGE_DELETE") {
                    var id = action.id;
                    var channelId = action.channelId;

                    if (!self.cache.has(id)) {
                        self.tryGrabFromStore(id, channelId);
                    }

                    if (id && channelId && self.cache.has(id) && !self.deleted.has(id)) {
                        self.deleted.set(id, channelId);
                        self.saveDeleted();
                        console.log("[SDM] Deleted: " + id);
                        setTimeout(function() {
                            var el = document.getElementById("chat-messages-" + channelId + "-" + id);
                            if (el) el.classList.add("rdm-del");
                        }, 50);
                    }
                    return Promise.resolve();
                }

                if (action.type === "MESSAGE_DELETE_BULK") {
                    var ids = action.ids || [];
                    var ch = action.channelId;
                    ids.forEach(function(id) {
                        if (!self.cache.has(id)) {
                            self.tryGrabFromStore(id, ch);
                        }
                        if (id && ch && self.cache.has(id) && !self.deleted.has(id)) {
                            self.deleted.set(id, ch);
                            setTimeout(function() {
                                var el = document.getElementById("chat-messages-" + ch + "-" + id);
                                if (el) el.classList.add("rdm-del");
                            }, 50);
                        }
                    });
                    self.saveDeleted();
                    return Promise.resolve();
                }
            } catch(e) {
                console.log("[RDM] Error: " + e);
            }

            return original.apply(this, args);
        });

        console.log("[RDM] Hooked");
    }

    startObserver() {
        var self = this;
        this._observer = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var node = nodes[j];
                    if (node.nodeType !== 1) continue;
                    self.tintNode(node);
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    }

    tintNode(root) {
        var self = this;
        var check = function(el) {
            if (!el.id || el.classList.contains("rdm-del")) return;
            var m = el.id.match(/chat-messages-\d+-(\d+)$/);
            if (m && self.deleted.has(m[1])) el.classList.add("rdm-del");
        };
        if (root.id) check(root);
        if (root.querySelectorAll) {
            var els = root.querySelectorAll('[id^="chat-messages-"]');
            for (var i = 0; i < els.length; i++) check(els[i]);
        }
    }

    reTintAll() {
        if (this.deleted.size === 0) return;
        var self = this;
        var els = document.querySelectorAll('[id^="chat-messages-"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!el.id || el.classList.contains("rdm-del")) continue;
            var m = el.id.match(/chat-messages-\d+-(\d+)$/);
            if (m && self.deleted.has(m[1])) el.classList.add("rdm-del");
        }
    }

    tryGrabFromStore(id, channelId) {
        try {
            var MS = BdApi.Webpack.getStore("MessageStore");
            if (!MS) return;
            var msgs = MS.getMessages(channelId);
            if (!msgs) return;
            var arr = msgs._array || [];
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && arr[i].id === id) {
                    this.cache.set(id, JSON.parse(JSON.stringify(arr[i])));
                    return;
                }
            }
        } catch(e) {}
    }

    loadDeleted() {
        var data = null;
        try { data = BdApi.Data.load("ShowDeletedMessages", "deleted"); } catch(e) {}
        if (!data) {
            try { data = JSON.parse(localStorage.getItem("sdm_deleted") || "null"); } catch(e) {}
        }
        if (data && typeof data === "object") {
            var self = this;
            Object.keys(data).forEach(function(id) {
                self.deleted.set(id, data[id]);
            });
        }
    }

    saveDeleted() {
        var obj = {};
        this.deleted.forEach(function(channelId, id) {
            obj[id] = channelId;
        });
        var json = JSON.stringify(obj);
        try { BdApi.Data.save("ShowDeletedMessages", "deleted", obj); } catch(e) {}
        try { localStorage.setItem("sdm_deleted", json); } catch(e) {}
    }

    injectCSS() {
        if (this.styleEl) return;
        var s = document.createElement("style");
        s.id = "rdm-css";
        s.textContent = ".rdm-del{border-left:3px solid #ed4245 !important;background:rgba(237,66,69,.04) !important;pointer-events:none !important}.rdm-del:hover{background:rgba(237,66,69,.08) !important}";
        document.head.appendChild(s);
        this.styleEl = s;
    }
};
