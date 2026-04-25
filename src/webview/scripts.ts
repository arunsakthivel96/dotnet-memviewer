export function getJsContent(): string {
    return `
var vscode = acquireVsCodeApi();
var snapshot = null;
var selectedHeapAddr = null;
var currentFilter = '';
var currentStateFilter = 'all';

// Tab switching
document.querySelectorAll('.tab').forEach(function(t) {
    t.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function(x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.getElementById('tab-' + t.dataset.tab).classList.add('active');
        if (t.dataset.tab === 'heap' && snapshot) drawHeapGraph();
    });
});

// Filter input
var filterInput = document.getElementById('filter-input');
var filterDebounce = null;
filterInput.addEventListener('input', function() {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(function() {
        currentFilter = filterInput.value.toLowerCase().trim();
        applyFilters();
    }, 150);
});

// Filter chips
document.querySelectorAll('.chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
        document.querySelectorAll('.chip').forEach(function(c) { c.classList.remove('active'); });
        chip.classList.add('active');
        currentStateFilter = chip.dataset.filter;
        applyFilters();
    });
});

// Action buttons
document.getElementById('clear-snapshot').addEventListener('click', function() {
    snapshot = null;
    document.getElementById('status').textContent = 'No snapshot loaded';
    document.getElementById('thread-list').innerHTML = '';
    document.getElementById('heap-detail').innerHTML = '';
    document.getElementById('stats-grid').innerHTML = '';
    var badge = document.getElementById('debug-badge');
    if (badge) badge.style.display = 'none';
    var canvas = document.getElementById('heapCanvas');
    if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    vscode.postMessage({ command: 'clearSnapshots' });
});

document.getElementById('clear-live').addEventListener('click', function() {
    vscode.postMessage({ command: 'clearLive' });
});

// Message handler
window.addEventListener('message', function(e) {
    var msg = e.data;
    if (msg.command === 'loadSnapshot') {
        snapshot = msg.data;
        var isDebug = snapshot.pid === 0;
        var badge = document.getElementById('debug-badge');
        if (badge) badge.style.display = isDebug ? 'inline-block' : 'none';
        var statusText = isDebug ? 'Debug Session' : ('PID ' + snapshot.pid);
        document.getElementById('status').textContent =
            statusText + ' \\u2014 ' + new Date(snapshot.timestamp).toLocaleTimeString() +
            ' \\u2014 ' + snapshot.threads.length + ' threads, ' +
            snapshot.threads.reduce(function(s,t){ return s + t.frames.length; }, 0) + ' frames';
        renderThreads();
        renderStats();
    } else if (msg.command === 'clear') {
        snapshot = null;
        document.getElementById('status').textContent = 'No snapshot loaded';
        document.getElementById('thread-list').innerHTML = '';
        document.getElementById('heap-detail').innerHTML = '';
        document.getElementById('stats-grid').innerHTML = '';
        var badge = document.getElementById('debug-badge');
        if (badge) badge.style.display = 'none';
        var canvas = document.getElementById('heapCanvas');
        if (canvas) {
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
});

function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
}
function highlightText(text, query) {
    if (!query) return esc(text);
    var escaped = esc(text);
    var idx = escaped.toLowerCase().indexOf(query);
    if (idx === -1) return escaped;
    return escaped.substring(0, idx) + '<span class="highlight">' + escaped.substring(idx, idx + query.length) + '</span>' + escaped.substring(idx + query.length);
}

function applyFilters() {
    if (!snapshot) return;
    var threads = document.querySelectorAll('.thread');
    var visibleCount = 0;
    var totalFrames = 0;
    threads.forEach(function(threadEl) {
        var threadData = threadEl._threadData;
        if (!threadData) return;
        var stateMatch = currentStateFilter === 'all' ||
            threadData.state.toLowerCase() === currentStateFilter ||
            (currentStateFilter === 'user' && !threadData.isBackground);
        var textMatch = true;
        if (currentFilter) {
            var searchText = (threadData.threadName + ' ' + threadData.state).toLowerCase();
            threadData.frames.forEach(function(f) {
                searchText += ' ' + f.typeName + ' ' + f.methodName + ' ' + f.moduleName;
                if (f.locals) f.locals.forEach(function(l) {
                    searchText += ' ' + l.name + ' ' + l.typeName + ' ' + l.value;
                });
            });
            textMatch = searchText.indexOf(currentFilter) !== -1;
        }
        if (stateMatch && textMatch) {
            threadEl.classList.remove('filtered-out');
            visibleCount++;
            // Filter individual frames if there's text filter
            if (currentFilter) {
                var frames = threadEl.querySelectorAll('.frame');
                frames.forEach(function(frameEl, idx) {
                    var f = threadData.frames[idx];
                    if (!f) return;
                    var frameText = (f.typeName + ' ' + f.methodName + ' ' + f.moduleName).toLowerCase();
                    if (f.locals) f.locals.forEach(function(l) {
                        frameText += ' ' + l.name + ' ' + l.typeName + ' ' + l.value;
                    });
                    if (frameText.indexOf(currentFilter) !== -1) {
                        frameEl.classList.remove('filtered-out');
                        totalFrames++;
                    } else {
                        frameEl.classList.add('filtered-out');
                    }
                });
                threadEl.classList.add('open');
            } else {
                threadEl.querySelectorAll('.frame').forEach(function(f) {
                    f.classList.remove('filtered-out');
                });
                totalFrames += threadData.frames.length;
            }
        } else {
            threadEl.classList.add('filtered-out');
        }
    });
    var countEl = document.getElementById('thread-count');
    if (countEl) {
        countEl.textContent = visibleCount + '/' + snapshot.threads.length + ' threads, ' + totalFrames + ' frames';
    }
}

function renderThreads() {
    var el = document.getElementById('thread-list');
    el.innerHTML = '';
    var totalFrames = 0;
    snapshot.threads.forEach(function(t) {
        var div = document.createElement('div');
        div.className = 'thread';
        div._threadData = t;
        var stateClass = t.state === 'Running' ? 'running' : (t.state === 'Stopped' ? 'stopped' : 'waiting');
        var framesHtml = '';
        t.frames.forEach(function(f) {
            var localsHtml = '';
            if (f.locals && f.locals.length) {
                localsHtml = '<div class="locals">' + f.locals.map(function(l) {
                    var arrow = l.isReferenceType && l.heapAddress
                        ? ' <span class="arrow" data-addr="' + l.heapAddress + '">\\u2192 ' + l.heapAddress + '</span>'
                        : '';
                    return '<div class="local"><span class="lname">' + highlightText(l.name, currentFilter) + '</span> ' +
                        '<span class="ltype">' + highlightText(l.typeName, currentFilter) + '</span> = ' +
                        '<span class="lval">' + highlightText(l.value, currentFilter) + '</span>' + arrow + '</div>';
                }).join('') + '</div>';
            }
            framesHtml += '<div class="frame"><span class="method">' + highlightText((f.typeName ? f.typeName + '.' : '') + f.methodName + '()', currentFilter) +
                '</span><span class="module">' + highlightText(f.moduleName, currentFilter) + '</span>' + localsHtml + '</div>';
        });
        totalFrames += t.frames.length;
        div.innerHTML = '<div class="thread-header"><span class="dot ' + stateClass + '"></span>' +
            '<span class="name">' + highlightText(t.threadName, currentFilter) + '</span>' +
            '<span class="frame-count">' + t.frames.length + ' frames</span>' +
            '<span class="tid">ID: ' + t.threadId + ' [' + t.state + ']</span></div>' +
            '<div class="frame-list">' + framesHtml + '</div>';
        div.querySelector('.thread-header').addEventListener('click', function() { div.classList.toggle('open'); });
        el.appendChild(div);
    });
    el.querySelectorAll('.arrow').forEach(function(a) {
        a.addEventListener('click', function(e) {
            e.stopPropagation();
            showHeapObject(a.dataset.addr);
        });
    });
    // Auto-open first thread
    var first = el.querySelector('.thread');
    if (first) first.classList.add('open');
    // Update count badge
    var countEl = document.getElementById('thread-count');
    if (countEl) {
        countEl.textContent = snapshot.threads.length + ' threads, ' + totalFrames + ' frames';
    }
}

function showHeapObject(addr) {
    selectedHeapAddr = addr;
    var panel = document.getElementById('heap-detail');
    var obj = snapshot.heap.objects.find(function(o) { return o.address === addr; });
    if (!obj) {
        panel.innerHTML = '<p style="color:var(--text2)">Object at ' + addr + ' not in snapshot</p>';
        return;
    }
    var fieldsHtml = obj.fields.map(function(f) {
        return '<div class="obj-field"><span class="fname">' + esc(f.name) + '</span>: ' +
            '<span class="fval">' + esc(f.value) + '</span></div>';
    }).join('');
    var refsHtml = '';
    if (obj.references.length) {
        refsHtml += '<div class="refs-section"><h4>References \\u2192</h4>' +
            obj.references.map(function(r) { return '<span class="ref-link" data-addr="' + r + '">' + r + '</span>'; }).join('') + '</div>';
    }
    if (obj.referencedBy.length) {
        refsHtml += '<div class="refs-section"><h4>\\u2190 Referenced By</h4>' +
            obj.referencedBy.map(function(r) { return '<span class="ref-link" data-addr="' + r + '">' + r + '</span>'; }).join('') + '</div>';
    }
    var genClass = 'gen' + Math.min(obj.generation, 2);
    panel.innerHTML = '<div class="heap-obj"><div class="obj-header"><span class="obj-type">' + esc(obj.typeName) +
        '</span><span class="obj-addr">' + obj.address + '</span></div>' +
        '<div class="obj-meta"><span>Size: ' + obj.size + ' B</span>' +
        '<span class="gen-badge ' + genClass + '">Gen ' + obj.generation + '</span></div>' +
        (fieldsHtml ? '<div class="obj-fields">' + fieldsHtml + '</div>' : '') + refsHtml + '</div>';
    panel.querySelectorAll('.ref-link').forEach(function(l) {
        l.addEventListener('click', function() { showHeapObject(l.dataset.addr); });
    });
    var heapCount = document.getElementById('heap-count');
    if (heapCount) heapCount.textContent = snapshot.heap.objects.length + ' objects';
}

function renderStats() {
    var h = snapshot.heap;
    var grid = document.getElementById('stats-grid');
    var cards = [
        {v: fmtBytes(h.totalSize), l: 'Total Heap'},
        {v: h.objectCount.toLocaleString(), l: 'Objects'},
        {v: h.gen0Count.toLocaleString(), l: 'Gen 0'},
        {v: h.gen1Count.toLocaleString(), l: 'Gen 1'},
        {v: h.gen2Count.toLocaleString(), l: 'Gen 2'},
        {v: h.lohCount.toLocaleString(), l: 'LOH'},
        {v: snapshot.threads.length, l: 'Threads'},
        {v: snapshot.threads.filter(function(t) { return t.state==='Running' || t.state==='Stopped'; }).length, l: 'Active'}
    ];
    grid.innerHTML = cards.map(function(c) {
        return '<div class="stat-card"><div class="stat-val">' + c.v + '</div><div class="stat-label">' + c.l + '</div></div>';
    }).join('');
    if (h.typeStatistics && h.typeStatistics.length) {
        var table = document.createElement('table');
        table.className = 'type-table';
        table.innerHTML = '<thead><tr><th>Type</th><th>Count</th><th>Size</th><th>%</th><th></th></tr></thead><tbody>' +
            h.typeStatistics.map(function(t) {
                return '<tr><td>' + esc(t.typeName) + '</td><td>' + t.count.toLocaleString() + '</td><td>' + fmtBytes(t.totalSize) +
                    '</td><td>' + t.percentage.toFixed(1) + '%</td><td><div class="bar"><div class="bar-fill" style="width:' +
                    Math.min(t.percentage * 2, 100) + '%"></div></div></td></tr>';
            }).join('') + '</tbody>';
        var statsPanel = document.getElementById('tab-stats');
        var old = statsPanel.querySelector('.type-table');
        if (old) old.remove();
        statsPanel.appendChild(table);
    }
}

function drawHeapGraph() {
    var canvas = document.getElementById('heapCanvas');
    var ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    if (!snapshot) return;
    var objs = snapshot.heap.objects;
    if (!objs.length) return;
    var nodes = objs.map(function(o) {
        return {
            x: canvas.width/2 + (Math.random()-0.5)*400,
            y: canvas.height/2 + (Math.random()-0.5)*300,
            vx: 0, vy: 0, obj: o, r: Math.max(12, Math.min(30, Math.sqrt(o.size/2)))
        };
    });
    var addrMap = {};
    nodes.forEach(function(n, i) { addrMap[n.obj.address] = i; });
    var edges = [];
    objs.forEach(function(o, i) {
        o.references.forEach(function(r) {
            if (addrMap[r] !== undefined) edges.push({s: i, t: addrMap[r]});
        });
    });
    var colors = ['#3fb950','#d29922','#f85149','#58a6ff'];
    var frame = 0;
    function tick() {
        if (frame > 200) return;
        frame++;
        for (var i = 0; i < nodes.length; i++) {
            for (var j = i+1; j < nodes.length; j++) {
                var dx = nodes[j].x - nodes[i].x;
                var dy = nodes[j].y - nodes[i].y;
                var d = Math.sqrt(dx*dx+dy*dy) || 1;
                var f = 2000 / (d*d);
                nodes[i].vx -= dx/d*f; nodes[i].vy -= dy/d*f;
                nodes[j].vx += dx/d*f; nodes[j].vy += dy/d*f;
            }
        }
        edges.forEach(function(e) {
            var dx = nodes[e.t].x - nodes[e.s].x;
            var dy = nodes[e.t].y - nodes[e.s].y;
            var d = Math.sqrt(dx*dx+dy*dy) || 1;
            var f = (d - 100) * 0.01;
            nodes[e.s].vx += dx/d*f; nodes[e.s].vy += dy/d*f;
            nodes[e.t].vx -= dx/d*f; nodes[e.t].vy -= dy/d*f;
        });
        nodes.forEach(function(n) {
            n.vx += (canvas.width/2 - n.x)*0.001;
            n.vy += (canvas.height/2 - n.y)*0.001;
            n.vx *= 0.9; n.vy *= 0.9;
            n.x += n.vx; n.y += n.vy;
        });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1;
        edges.forEach(function(e) {
            ctx.beginPath();
            ctx.moveTo(nodes[e.s].x, nodes[e.s].y);
            ctx.lineTo(nodes[e.t].x, nodes[e.t].y);
            ctx.stroke();
            var dx2 = nodes[e.t].x - nodes[e.s].x;
            var dy2 = nodes[e.t].y - nodes[e.s].y;
            var a = Math.atan2(dy2, dx2);
            var tr = nodes[e.t].r;
            var ax = nodes[e.t].x - Math.cos(a)*tr;
            var ay = nodes[e.t].y - Math.sin(a)*tr;
            ctx.fillStyle = '#58a6ff';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - 8*Math.cos(a-0.4), ay - 8*Math.sin(a-0.4));
            ctx.lineTo(ax - 8*Math.cos(a+0.4), ay - 8*Math.sin(a+0.4));
            ctx.fill();
        });
        nodes.forEach(function(n) {
            var g = Math.min(n.obj.generation, 3);
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
            ctx.fillStyle = colors[g] + '33';
            ctx.fill();
            ctx.strokeStyle = colors[g];
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#e6edf3';
            ctx.font = '9px system-ui';
            ctx.textAlign = 'center';
            var short = n.obj.typeName.split('.').pop() || '';
            ctx.fillText(short.substring(0, 12), n.x, n.y + 3);
        });
        requestAnimationFrame(tick);
    }
    tick();
}
`;
}
