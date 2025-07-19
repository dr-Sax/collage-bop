class ARTracker {
    constructor() {
        this.ws = null;
        this.markers = new Map();
        this.players = new Map();
        this.anims = new Map();
        this.config = null;
        
        this.loadYT().then(() => this.loadConfig().then(() => this.init()));
    }

    async loadYT() {
        return new Promise(resolve => {
            if (window.YT?.Player) return resolve();
            window.onYouTubeIframeAPIReady = resolve;
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }
        });
    }

    async loadConfig() {
        try {
            this.config = await fetch('marker_config.json').then(r => r.json());
        } catch (e) {
            this.config = { markers: {}, default: { width: "512px", height: "288px", src: "https://www.youtube.com/embed/dQw4w9WgXcQ", clip_path: "circle(50% at 50% 50%)" }};
        }
    }

    init() {
        this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 1000);
        this.scene = new THREE.Scene();
        this.renderer = new THREE.CSS3DRenderer();
        this.renderer.setSize(innerWidth, innerHeight);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        document.getElementById('container').appendChild(this.renderer.domElement);
        this.connect();
        addEventListener('resize', () => this.resize());
        this.animate();
    }

    createMarker(id) {
        const cfg = this.config.markers[id.toString()] || this.config.default;
        const vid = cfg.src.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/)?.[1];
        
        const container = document.createElement('div');
        container.style.cssText = `width: ${cfg.width}; height: ${cfg.height}; clip-path: ${cfg.clip_path}; overflow: hidden; position: relative;`;
        
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${id}`;
        playerDiv.style.cssText = 'width: 100%; height: 100%;';
        container.appendChild(playerDiv);
        
        if (vid) {
            setTimeout(() => {
                const player = new YT.Player(playerDiv.id, {
                    videoId: vid, width: '100%', height: '100%',
                    playerVars: { autoplay: 1, loop: 1, mute: 1, controls: 0, playlist: vid, rel: 0, showinfo: 0 },
                    events: { onReady: (e) => e.target.playVideo() }
                });
                this.players.set(id, player);
            }, 100);
        }
        
        if (cfg.anim) this.startAnim(container, id, cfg.anim);
        return new THREE.CSS3DObject(container);
    }

    startAnim(container, id, cfg) {
        this.anims.set(id, { container, id, ...cfg, start: Date.now() });
        this.runAnim(id);
    }

    runAnim(id) {
        const a = this.anims.get(id);
        if (!a) return;
        
        const t = ((Date.now() - a.start) % (a.dur * 1000)) / (a.dur * 1000);
        const path = this.getPath(a, t);
        a.container.style.clipPath = path;
        requestAnimationFrame(() => this.runAnim(id));
    }

    getPath(a, t) {
        switch (a.type) {
            case 'morph': return this.morph(a.frames, t);
            case 'breathe': return this.breathe(a.shape, t, a.amp || 0.3);
            case 'star': return this.star(t, a.pts || 5, a.inner || 0.4);
            case 'wave': return this.wave(t, a.amp || 10, a.freq || 3);
            default: return a.frames?.[0] || 'circle(50% at 50% 50%)';
        }
    }

    morph(frames, t) {
        const idx = Math.floor(t * (frames.length - 1));
        const next = Math.min(idx + 1, frames.length - 1);
        const prog = (t * (frames.length - 1)) - idx;
        return this.lerp(frames[idx], frames[next], prog);
    }

    breathe(shape, t, amp) {
        const scale = 1 + Math.sin(t * Math.PI * 2) * amp;
        if (shape.includes('circle')) {
            const [r, x, y] = shape.match(/circle\(([^%]+)%\s+at\s+([^%]+)%\s+([^%]+)%\)/).slice(1).map(Number);
            return `circle(${r * scale}% at ${x}% ${y}%)`;
        }
        return shape;
    }

    star(t, pts, inner) {
        const rot = t * Math.PI * 2;
        const points = [];
        for (let i = 0; i < pts * 2; i++) {
            const angle = (i * Math.PI) / pts + rot;
            const radius = i % 2 === 0 ? 50 : 50 * inner;
            const x = 50 + radius * Math.cos(angle);
            const y = 50 + radius * Math.sin(angle);
            points.push(`${x}% ${y}%`);
        }
        return `polygon(${points.join(', ')})`;
    }

    wave(t, amp, freq) {
        const points = [];
        for (let i = 0; i <= 20; i++) {
            const x = (i / 20) * 100;
            const y = 50 + Math.sin((i / 20) * freq * Math.PI * 2 + t * Math.PI * 2) * amp;
            points.push(`${x}% ${y}%`);
        }
        points.push('100% 100%', '0% 100%');
        return `polygon(${points.join(', ')})`;
    }

    lerp(from, to, t) {
        const parsePoints = (s) => s.match(/polygon\(([^)]+)\)/)?.[1].split(',').map(p => p.trim().split(/\s+/).map(parseFloat)) || [];
        const fromPts = parsePoints(from);
        const toPts = parsePoints(to);
        if (!fromPts.length || !toPts.length) return t < 0.5 ? from : to;
        
        const maxPts = Math.max(fromPts.length, toPts.length);
        const interpolated = [];
        for (let i = 0; i < maxPts; i++) {
            const fp = fromPts[i % fromPts.length] || [0, 0];
            const tp = toPts[i % toPts.length] || [0, 0];
            const x = fp[0] + (tp[0] - fp[0]) * t;
            const y = fp[1] + (tp[1] - fp[1]) * t;
            interpolated.push(`${x}% ${y}%`);
        }
        return `polygon(${interpolated.join(', ')})`;
    }

    connect() {
        this.ws = new WebSocket('ws://localhost:8765');
        this.ws.onopen = () => this.updateStatus('connected', 'Connected');
        this.ws.onclose = () => { this.updateStatus('disconnected', 'Disconnected'); setTimeout(() => this.connect(), 3000); };
        this.ws.onmessage = e => {
            const data = JSON.parse(e.data);
            this.updateMarkers(data.markers);
            this.updateCounts(Object.keys(data.markers).length);
        };
    }

    updateMarkers(markers) {
        Object.entries(markers).forEach(([id, data]) => {
            id = parseInt(id);
            if (!this.markers.has(id)) {
                const element = this.createMarker(id);
                this.group.add(element);
                this.markers.set(id, element);
            }
            const marker = this.markers.get(id);
            marker.position.set(-data.position.x * 3200 + 200, -data.position.y * 1500 + 250, -data.position.z * 100);
            marker.rotation.set(data.rotation.x * Math.PI/180, data.rotation.y * Math.PI/180, data.rotation.z * Math.PI/180);
            marker.visible = true;
        });
    }

    updateStatus(className, text) {
        const conn = document.getElementById('conn');
        if (conn) { conn.className = className; conn.textContent = text; }
    }

    updateCounts(markers) {
        document.getElementById('markers').textContent = markers;
        document.getElementById('players').textContent = this.players.size;
    }

    resize() {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
}

// Global instance and controls
window.ar = new ARTracker();
window.controls = {
    vol: (id, v) => ar.players.get(id)?.setVolume(v),
    mute: (id) => ar.players.get(id)?.mute(),
    unmute: (id) => ar.players.get(id)?.unMute(),
    play: (id) => ar.players.get(id)?.playVideo(),
    pause: (id) => ar.players.get(id)?.pauseVideo(),
    seek: (id, t) => ar.players.get(id)?.seekTo(t),
    anim: (id, cfg) => { const m = ar.markers.get(id); if (m) ar.startAnim(m.element, id, cfg); },
    stop: (id) => ar.anims.delete(id)
};