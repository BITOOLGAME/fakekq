(function () {
    'use strict';

    // ============================================================
    // PHẦN 1: KHỞI TẠO & STATE
    // ============================================================
    
    if (window.__TOOL_LO_V2__) return;
    window.__TOOL_LO_V2__ = true;

    const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions';
    const POLL_MS = 2000;

    // Emoji dice
    const D_EMOJI = { 1:'⚀', 2:'⚁', 3:'⚂', 4:'⚃', 5:'⚄', 6:'⚅' };

    // Lưu hàm gốc
    const _origFetch = window.fetch.bind(window);
    const _OrigXHR   = window.XMLHttpRequest;
    const _OrigWS    = window.WebSocket;

    // State
    const M = {
        currentPhien : 0,
        nextPhien    : 0,
        dice         : [4, 5, 6],
        active       : true,
        lastPhien    : 0,
        historyCache : new Map(),
        patchedDice  : new Map(),
    };

    // ============================================================
    // PHẦN 2: HÀM XỬ LÝ DICE
    // ============================================================

    function randInt(a, b) {
        return Math.floor(Math.random() * (b - a + 1)) + a;
    }

    function randomDice() {
        let d, s, tries = 0;
        do {
            d = [randInt(1, 6), randInt(1, 6), randInt(1, 6)];
            s = d[0] + d[1] + d[2];
            tries++;
        } while ((s === 10 || s === 11) && tries < 30);
        return d;
    }

    function sumDice(d) {
        return d[0] + d[1] + d[2];
    }

    function diceStr(d) {
        return d.map(v => D_EMOJI[v] || v).join(' ');
    }

    function getEntryId(e) {
        const raw = e.id ?? e.sessionId ?? e.referenceId ?? e.phienId ?? e.session_id ?? e._id ?? 0;
        return parseInt(String(raw).replace(/\D/g, ''), 10) || 0;
    }

    // ============================================================
    // PHẦN 3: PATCH JSON RESPONSE
    // ============================================================

    function patchVerifyStr(str, dice) {
        if (typeof str !== 'string') return str;
        return str.replace(/\((\d+)-(\d+)-(\d+)\)/g, `(${dice[0]}-${dice[1]}-${dice[2]})`);
    }

    function patchVerifyFields(e, dice) {
        const VERIFY_FIELDS = ['string','verifyString','verifyCode','proof',
                               'hash','code','verify','previewStr','previewString',
                               'str','chuoi','chuoiMa','chuoiKiemTra'];
        for (const f of VERIFY_FIELDS) {
            if (typeof e[f] === 'string') e[f] = patchVerifyStr(e[f], dice);
        }
    }

    function patchEntry(e) {
        const sid = getEntryId(e);
        if (!sid) return;

        if (M.patchedDice.has(sid)) {
            const pd   = M.patchedDice.get(sid);
            const ps   = pd[0] + pd[1] + pd[2];
            const ptai = ps >= 11;
            
            if (e.dices  != null) e.dices  = pd.slice();
            if (e.dice   != null) e.dice   = pd.slice();
            if (e.dice1  != null) { e.dice1 = pd[0]; e.dice2 = pd[1]; e.dice3 = pd[2]; }
            if (e.total  != null) e.total  = ps;
            if (e.point  != null) e.point  = ps;
            if (e.score  != null) e.score  = ps;
            if (e.sum    != null) e.sum    = ps;
            
            if (e.result != null) {
                e.result = typeof e.result === 'number' ? (ptai ? 1 : 0) : (ptai ? 'tai' : 'xiu');
            }
            if (e.resultTruyenThong != null) {
                e.resultTruyenThong = ptai ? 'TAI' : 'XIU';
            }
            if (e.type != null) {
                e.type = typeof e.type === 'number' ? (ptai ? 1 : 0) : (ptai ? 'tai' : 'xiu');
            }

            patchVerifyFields(e, pd);
        } else if (M.historyCache.has(sid)) {
            Object.assign(e, M.historyCache.get(sid));
        }
    }

    function patchJson(raw) {
        if (typeof raw !== 'string' || raw.length < 2) return raw;
        try {
            let out = raw;

            if (M.active) {
                const d = M.dice;
                const s = sumDice(d);
                const tai = s >= 11;
                const resultStr = tai ? 'tai' : 'xiu';
                const resultStrUpper = tai ? 'TAI' : 'XIU';

                // Patch các field dice
                out = out.replace(/"dices"\s*:\s*\[[^\]]*\]/g,  `"dices":[${d}]`);
                out = out.replace(/"dice"\s*:\s*\[[^\]]*\]/g,   `"dice":[${d}]`);
                out = out.replace(/"dice1"\s*:\s*\d+/g,  `"dice1":${d[0]}`);
                out = out.replace(/"dice2"\s*:\s*\d+/g,  `"dice2":${d[1]}`);
                out = out.replace(/"dice3"\s*:\s*\d+/g,  `"dice3":${d[2]}`);
                
                // Patch total, point, score
                out = out.replace(/"total"\s*:\s*\d+/g,  `"total":${s}`);
                out = out.replace(/"point"\s*:\s*\d+/g,  `"point":${s}`);
                out = out.replace(/"score"\s*:\s*\d+/g,  `"score":${s}`);
                out = out.replace(/"sum"\s*:\s*\d+/g,    `"sum":${s}`);
                
                // Patch error
                out = out.replace(/"error"\s*:\s*\d+/g,  '"error":0');
                
                // Patch result (các biến thể)
                out = out.replace(/"result"\s*:\s*"(tai|xiu|big|small|TAI|XIU)"/gi,
                    `"result":"${resultStr}"`);
                out = out.replace(/"resultTruyenThong"\s*:\s*"(TAI|XIU)"/gi,
                    `"resultTruyenThong":"${resultStrUpper}"`);
                out = out.replace(/"ketQua"\s*:\s*"(tai|xiu|TAI|XIU)"/gi,
                    `"ketQua":"${resultStrUpper}"`);

                // Patch verify string
                out = out.replace(/\((\d+)-(\d+)-(\d+)\)/g, `(${d[0]}-${d[1]}-${d[2]})`);
                
                // Patch các verify fields
                out = out.replace(
                    /("(?:string|verifyString|verifyCode|proof|hash|code|verify|previewStr|previewString)"\s*:\s*")([^"]*)\(/g,
                    (_, prefix, before) => `${prefix}${before}(`
                );
            }

            // Xử lý history/list/sessions
            if (/("history"|"list"|"records"|"sessions")/.test(raw)) {
                try {
                    const obj = JSON.parse(out);
                    const arr = obj.list ?? obj.history ?? obj.records ?? obj.sessions ??
                                obj.data?.list ?? obj.data?.history ?? obj.data?.records ?? obj.data?.sessions ?? null;
                    if (Array.isArray(arr) && arr.length) {
                        arr.forEach(e => patchEntry(e));
                        return JSON.stringify(obj);
                    }
                } catch(_) {}
            }

            return out;
        } catch(_) { 
            return raw; 
        }
    }

    // ============================================================
    // PHẦN 4: PATCH WEBSOCKET
    // ============================================================

    const _seen = new WeakSet();

    function wrapMsg(ev, fn, ctx) {
        if (_seen.has(ev)) return fn.call(ctx, ev);
        _seen.add(ev);
        let data = ev.data;
        if (typeof data === 'string') data = patchJson(data);
        const ne = new MessageEvent('message', {
            data: data,
            origin: ev.origin,
            lastEventId: ev.lastEventId,
            source: ev.source,
            ports: ev.ports,
        });
        _seen.add(ne);
        fn.call(ctx, ne);
    }

    window.WebSocket = function(url, proto) {
        const ws = proto ? new _OrigWS(url, proto) : new _OrigWS(url);
        const _ael = ws.addEventListener.bind(ws);
        
        ws.addEventListener = function(type, fn, opts) {
            if (type !== 'message' || typeof fn !== 'function') {
                return _ael(type, fn, opts);
            }
            return _ael(type, ev => wrapMsg(ev, fn, ws), opts);
        };
        
        let _stored = null;
        Object.defineProperty(ws, 'onmessage', {
            configurable: true,
            enumerable: true,
            get() { return _stored; },
            set(fn) {
                _stored = fn;
                const desc = Object.getOwnPropertyDescriptor(_OrigWS.prototype, 'onmessage');
                try {
                    desc?.set?.call(ws, fn ? ev => wrapMsg(ev, fn, ws) : null);
                } catch(_) {}
            },
        });
        return ws;
    };

    // Copy static properties
    Object.keys(_OrigWS).forEach(k => {
        try { window.WebSocket[k] = _OrigWS[k]; } catch(_) {}
    });
    window.WebSocket.prototype = _OrigWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => {
        try { window.WebSocket[k] = _OrigWS[k]; } catch(_) {}
    });

    // ============================================================
    // PHẦN 5: PATCH FETCH API
    // ============================================================

    window.fetch = async function(input, init) {
        const resp = await _origFetch(input, init);
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('json') && !ct.includes('text')) return resp;
        
        try {
            const text = await resp.text();
            const patched = patchJson(text);
            if (patched === text) return resp;
            return new Response(patched, {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers,
            });
        } catch(_) { 
            return resp; 
        }
    };

    // ============================================================
    // PHẦN 6: PATCH XMLHttpRequest
    // ============================================================

    window.XMLHttpRequest = function() {
        const xhr = new _OrigXHR();
        
        xhr.addEventListener('readystatechange', function() {
            if (xhr.readyState !== 4) return;
            const ct = xhr.getResponseHeader('content-type') || '';
            if (!ct.includes('json') && !ct.includes('text')) return;
            
            try {
                const patched = patchJson(xhr.responseText);
                if (patched === xhr.responseText) return;
                Object.defineProperty(xhr, 'responseText', { 
                    value: patched, 
                    configurable: true, 
                    writable: true 
                });
                Object.defineProperty(xhr, 'response', { 
                    value: patched, 
                    configurable: true, 
                    writable: true 
                });
            } catch(_) {}
        });
        return xhr;
    };
    
    window.XMLHttpRequest.prototype = _OrigXHR.prototype;
    Object.keys(_OrigXHR).forEach(k => {
        try { window.XMLHttpRequest[k] = _OrigXHR[k]; } catch(_) {}
    });

    // ============================================================
    // PHẦN 7: POLLING API
    // ============================================================

    async function fetchPhien() {
        try {
            const r = await _origFetch(API_URL, { cache: 'no-store' });
            if (!r.ok) return null;
            const json = await r.json();
            
            const list = json.list ?? json.data?.list ?? json.sessions ?? json.data ?? [];
            if (!Array.isArray(list) || !list.length) return null;

            list.forEach(e => {
                const sid = getEntryId(e);
                if (sid > 0 && !M.historyCache.has(sid)) {
                    M.historyCache.set(sid, JSON.parse(JSON.stringify(e)));
                }
            });

            const ids = list.map(getEntryId).filter(n => n > 0);
            return ids.length ? Math.max(...ids) : null;
        } catch(_) { 
            return null; 
        }
    }

    async function pollLoop() {
        while (true) {
            const maxId = await fetchPhien();
            if (maxId && maxId > 0) {
                M.currentPhien = maxId;
                M.nextPhien = maxId + 1;
                if (maxId !== M.lastPhien) {
                    M.lastPhien = maxId;
                    if (M.active) {
                        M.dice = randomDice();
                        M.patchedDice.set(maxId, M.dice.slice());
                    }
                }
                updateUI();
            }
            await new Promise(r => setTimeout(r, POLL_MS));
        }
    }

    // ============================================================
    // PHẦN 8: UI - TOOL LỎ (VÀNG - ĐỎ)
    // ============================================================

    function injectCSS() {
        if (document.getElementById('_tl_css')) return;
        const s = document.createElement('style');
        s.id = '_tl_css';
        s.textContent = `
            @keyframes tl-border-spin { 100% { transform: rotate(360deg); } }
            @keyframes tl-fade-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes tl-pulse { 0%,100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.35); } 50% { box-shadow: 0 0 22px rgba(255, 215, 0, 0.8); } }
            
            #_tl_wrap {
                position: fixed;
                top: 60px;
                right: 16px;
                min-width: 240px;
                z-index: 2147483647;
                font-family: 'Segoe UI', Consolas, 'Courier New', monospace;
                user-select: none;
                animation: tl-pulse 3s ease-in-out infinite;
            }
            
            #_tl_panel {
                background: linear-gradient(145deg, rgba(20, 10, 5, 0.97), rgba(40, 15, 5, 0.97));
                border: 1.5px solid transparent;
                border-radius: 14px;
                overflow: hidden;
                position: relative;
                backdrop-filter: blur(14px);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 215, 0, 0.1);
            }
            
            #_tl_panel::before {
                content: '';
                position: absolute;
                width: 200%;
                height: 200%;
                top: -50%;
                left: -50%;
                background: conic-gradient(from 0deg, #ffd700, #ff4d00, #ffd700, #ff4d00, #ffd700);
                animation: tl-border-spin 3s linear infinite;
                z-index: 0;
            }
            
            #_tl_panel::after {
                content: '';
                position: absolute;
                inset: 1.5px;
                background: linear-gradient(145deg, rgba(20, 10, 5, 0.98), rgba(40, 15, 5, 0.98));
                border-radius: 13px;
                z-index: 0;
            }
            
            #_tl_inner { position: relative; z-index: 1; }
            
            #_tl_header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 14px;
                cursor: grab;
                background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(255, 77, 0, 0.12));
                border-bottom: 1px solid rgba(255, 215, 0, 0.2);
            }
            #_tl_header:active { cursor: grabbing; }
            
            #_tl_title {
                font-size: 13px;
                font-weight: 800;
                letter-spacing: 1.5px;
                background: linear-gradient(90deg, #ffd700, #ff6b00, #ffd700);
                background-size: 200% auto;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: tl-shine 2s linear infinite;
            }
            
            @keyframes tl-shine {
                0% { background-position: 0% center; }
                100% { background-position: 200% center; }
            }
            
            #_tl_closebtn {
                width: 22px;
                height: 22px;
                border-radius: 50%;
                border: 1px solid rgba(255, 215, 0, 0.4);
                background: rgba(255, 215, 0, 0.08);
                color: #ffd700;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                flex-shrink: 0;
                line-height: 1;
            }
            #_tl_closebtn:hover {
                background: rgba(255, 215, 0, 0.25);
                border-color: #ffd700;
                transform: scale(1.1);
            }
            
            #_tl_body { padding: 12px 14px 14px; animation: tl-fade-in 0.25s ease; }
            
            .tl-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 0;
                border-bottom: 1px solid rgba(255, 215, 0, 0.06);
            }
            .tl-row:last-child { border-bottom: none; }
            
            .tl-lbl {
                font-size: 10px;
                font-weight: 600;
                color: #b8860b;
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }
            
            .tl-val {
                font-size: 13px;
                font-weight: 700;
                color: #ffd700;
                text-align: right;
            }
            
            .tl-tai { color: #ff4d4d; text-shadow: 0 0 15px rgba(255, 77, 77, 0.3); }
            .tl-xiu { color: #ffd700; text-shadow: 0 0 15px rgba(255, 215, 0, 0.3); }
            .tl-phien { color: #ff6b00; font-size: 14px; }
            
            .tl-dice-emojis { font-size: 20px; letter-spacing: 3px; }
            .tl-sum { font-size: 10px; color: #b8860b; margin-top: 1px; }
            
            .tl-sw-wrap { display: flex; align-items: center; gap: 8px; }
            
            .tl-sw {
                width: 38px;
                height: 20px;
                border-radius: 10px;
                position: relative;
                cursor: pointer;
                background: rgba(40, 15, 5, 0.8);
                border: 1px solid rgba(255, 215, 0, 0.2);
                transition: background 0.25s;
            }
            .tl-sw.on {
                background: linear-gradient(90deg, #ffd700, #ff6b00);
                border-color: #ffd700;
            }
            
            .tl-sw-knob {
                position: absolute;
                top: 2px;
                left: 2px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #fff;
                transition: left 0.25s;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
            }
            .tl-sw.on .tl-sw-knob { left: 20px; }
            
            .tl-swlbl {
                font-size: 10px;
                font-weight: 600;
                color: #b8860b;
            }
            
            #_tl_openbtn {
                position: fixed;
                top: 60px;
                right: 16px;
                z-index: 2147483647;
                padding: 8px 18px;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(255, 215, 0, 0.2), rgba(255, 77, 0, 0.15));
                border: 1.5px solid #ffd700;
                color: #ffd700;
                font-family: 'Segoe UI', Consolas, monospace;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                letter-spacing: 1px;
                display: none;
                box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
                transition: all 0.3s;
                text-transform: uppercase;
            }
            #_tl_openbtn:hover {
                background: rgba(255, 215, 0, 0.25);
                transform: scale(1.05);
                box-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
            }
            
            .tl-author {
                font-size: 9px;
                color: #b8860b;
                text-align: center;
                padding-top: 6px;
                border-top: 1px solid rgba(255, 215, 0, 0.06);
                margin-top: 6px;
                letter-spacing: 0.5px;
            }
            .tl-author span { color: #ff6b00; font-weight: 700; }
        `;
        document.head.appendChild(s);
    }

    let _wrap, _openBtn, _sesEl, _diceEl, _sumEl, _resultEl, _sw;

    function buildUI() {
        if (document.getElementById('_tl_wrap')) return;
        injectCSS();

        // Open button
        _openBtn = document.createElement('button');
        _openBtn.id = '_tl_openbtn';
        _openBtn.textContent = '🎲 Tool Lỏ';
        document.body.appendChild(_openBtn);
        _openBtn.addEventListener('click', () => {
            _wrap.style.display = 'block';
            _openBtn.style.display = 'none';
        });

        // Main wrap
        _wrap = document.createElement('div');
        _wrap.id = '_tl_wrap';
        document.body.appendChild(_wrap);

        const panel = document.createElement('div');
        panel.id = '_tl_panel';
        const inner = document.createElement('div');
        inner.id = '_tl_inner';
        panel.appendChild(inner);
        _wrap.appendChild(panel);

        // Header
        const hdr = document.createElement('div');
        hdr.id = '_tl_header';
        const title = document.createElement('span');
        title.id = '_tl_title';
        title.textContent = '🎲 TOOL LỎ';
        const closeBtn = document.createElement('div');
        closeBtn.id = '_tl_closebtn';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _wrap.style.display = 'none';
            _openBtn.style.display = 'block';
        });
        hdr.appendChild(title);
        hdr.appendChild(closeBtn);
        inner.appendChild(hdr);

        // Body
        const body = document.createElement('div');
        body.id = '_tl_body';
        inner.appendChild(body);

        function mkRow(lbl) {
            const r = document.createElement('div');
            r.className = 'tl-row';
            const l = document.createElement('span');
            l.className = 'tl-lbl';
            l.textContent = lbl;
            r.appendChild(l);
            body.appendChild(r);
            return r;
        }

        // Row 1: Phiên
        const r1 = mkRow('📌 PHIÊN');
        _sesEl = document.createElement('span');
        _sesEl.className = 'tl-val tl-phien';
        _sesEl.textContent = '…';
        r1.appendChild(_sesEl);

        // Row 2: Dice
        const r2 = mkRow('🎲 XÚC XẮC');
        const dw = document.createElement('div');
        dw.style.textAlign = 'right';
        _diceEl = document.createElement('div');
        _diceEl.className = 'tl-val tl-dice-emojis';
        _sumEl = document.createElement('div');
        _sumEl.className = 'tl-sum';
        dw.appendChild(_diceEl);
        dw.appendChild(_sumEl);
        r2.appendChild(dw);

        // Row 3: Kết quả
        const r3 = mkRow('🏆 KẾT QUẢ');
        _resultEl = document.createElement('span');
        _resultEl.className = 'tl-val';
        _resultEl.textContent = '…';
        r3.appendChild(_resultEl);

        // Row 4: Switch
        const r4 = mkRow('🔧 HACK');
        const swWrap = document.createElement('div');
        swWrap.className = 'tl-sw-wrap';
        _sw = document.createElement('div');
        _sw.className = 'tl-sw' + (M.active ? ' on' : '');
        const knob = document.createElement('div');
        knob.className = 'tl-sw-knob';
        const swTxt = document.createElement('span');
        swTxt.className = 'tl-swlbl';
        swTxt.textContent = M.active ? 'BẬT' : 'TẮT';
        _sw.appendChild(knob);
        _sw.addEventListener('click', () => {
            M.active = !M.active;
            _sw.className = 'tl-sw' + (M.active ? ' on' : '');
            swTxt.textContent = M.active ? 'BẬT' : 'TẮT';
            updateUI();
        });
        swWrap.appendChild(swTxt);
        swWrap.appendChild(_sw);
        r4.appendChild(swWrap);

        // Author
        const author = document.createElement('div');
        author.className = 'tl-author';
        author.innerHTML = '⚡ by <span>ZukaNoPro2</span> | Tool Lỏ';
        body.appendChild(author);

        updateUI();
        makeDraggable(_wrap, hdr);
    }

    function updateUI() {
        if (!_sesEl) return;
        const d = M.dice;
        const s = sumDice(d);
        const tai = s >= 11;
        
        _sesEl.textContent = M.nextPhien > 0 ? `#${M.nextPhien}` : '…';
        _diceEl.textContent = diceStr(d);
        _sumEl.textContent = `Tổng: ${s} điểm`;
        _resultEl.className = `tl-val ${tai ? 'tl-tai' : 'tl-xiu'}`;
        _resultEl.textContent = tai ? '⬆ TÀI' : '⬇ XỈU';
    }

    // ============================================================
    // PHẦN 9: DRAGGABLE
    // ============================================================

    function makeDraggable(el, handle) {
        let drag = false, ox = 0, oy = 0, sx = 0, sy = 0, moved = false;
        const xy = (e) => ({
            x: e.clientX ?? e.touches?.[0]?.clientX ?? 0,
            y: e.clientY ?? e.touches?.[0]?.clientY ?? 0
        });

        handle.addEventListener('mousedown', (e) => {
            drag = true;
            moved = false;
            const { x, y } = xy(e);
            sx = x;
            sy = y;
            const r = el.getBoundingClientRect();
            ox = r.left;
            oy = r.top;
            if (e.cancelable) e.preventDefault();
        });

        handle.addEventListener('touchstart', (e) => {
            drag = true;
            moved = false;
            const { x, y } = xy(e);
            sx = x;
            sy = y;
            const r = el.getBoundingClientRect();
            ox = r.left;
            oy = r.top;
        }, { passive: true });

        const move = (e) => {
            if (!drag) return;
            const { x, y } = xy(e);
            if (Math.abs(x - sx) > 3 || Math.abs(y - sy) > 3) moved = true;
            if (!moved) return;
            el.style.right = 'auto';
            el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, ox + x - sx)) + 'px';
            el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + y - sy)) + 'px';
        };

        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: true });
        document.addEventListener('mouseup', () => drag = false);
        document.addEventListener('touchend', () => drag = false);
    }

    // ============================================================
    // PHẦN 10: KHỞI CHẠY
    // ============================================================

    function start() {
        if (document.body) buildUI();
        else document.addEventListener('DOMContentLoaded', buildUI, { once: true });
        pollLoop();
    }

    start();

})();