class ARTracker {
    constructor() {
        this.ws = null;
        this.markers = new Map();
        this.players = new Map();
        this.anims = new Map();
        this.config = null;
        this.animFrame = null;
        this.lastFrame = 0;
        this.FPS = 60; // Target FPS
        this.frameInterval = 1000 / this.FPS;
        
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
        this.startAnimLoop();
    }

    createMarker(id) {
        const cfg = this.config.markers[id.toString()] || this.config.default;
        const vid = cfg.src.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/)?.[1];
        
        const container = document.createElement('div');
        container.style.cssText = `width: ${cfg.width}; height: ${cfg.height}; clip-path: ${cfg.clip_path}; overflow: hidden; position: relative; will-change: clip-path; transform: translateZ(0);`;
        
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${id}`;
        playerDiv.style.cssText = 'width: 100%; height: 100%;';
        container.appendChild(playerDiv);
        
        if (vid) {
            setTimeout(() => {
                const player = new YT.Player(playerDiv.id, {
                    videoId: vid, width: '100%', height: '100%',
                    playerVars: { autoplay: 1, loop: 1, mute: 0, controls: 0, playlist: vid, rel: 0, showinfo: 0, quality: 'small' },
                    events: { onReady: (e) => e.target.playVideo() }
                });
                this.players.set(id, player);
            }, 100);
        }
        
        // Handle animations - start animation if specified, otherwise ensure static clip path is applied
        if (cfg.anim && Object.keys(cfg.anim).length > 0) {
            this.startAnim(container, id, cfg.anim);
        } else {
            // For static markers, ensure the clip path is properly applied
            // This is important because sometimes the initial CSS doesn't take effect immediately
            setTimeout(() => {
                container.style.clipPath = cfg.clip_path;
            }, 50);
        }
        
        return new THREE.CSS3DObject(container);
    }

    startAnim(container, id, cfg) {
        // Pre-calculate animation frames for better performance
        const frames = this.preCalculateFrames(cfg);
        this.anims.set(id, { 
            container, 
            id, 
            ...cfg, 
            start: Date.now(),
            frames: frames,
            lastUpdate: 0
        });
    }

    preCalculateFrames(cfg) {
        if (cfg.type !== 'morph') return null;
        
        const frameCount = 60; // Pre-calculate 60 frames
        const frames = [];
        
        for (let i = 0; i < frameCount; i++) {
            const t = i / (frameCount - 1);
            frames.push(this.morph(cfg.frames, t));
        }
        
        return frames;
    }

    startAnimLoop() {
        const animLoop = (currentTime) => {
            // Throttle to target FPS
            if (currentTime - this.lastFrame >= this.frameInterval) {
                this.updateAllAnims();
                this.renderer.render(this.scene, this.camera);
                this.lastFrame = currentTime;
            }
            this.animFrame = requestAnimationFrame(animLoop);
        };
        this.animFrame = requestAnimationFrame(animLoop);
    }

    updateAllAnims() {
        const now = Date.now();
        for (const [id, a] of this.anims) {
            // Skip if updated too recently (throttle individual animations)
            if (now - a.lastUpdate < 16) continue; // ~60fps per animation
            
            const t = ((now - a.start) % (a.dur * 1000)) / (a.dur * 1000);
            const path = this.getPath(a, t);
            
            // Only update if path actually changed
            if (a.lastPath !== path) {
                a.container.style.clipPath = path;
                a.lastPath = path;
                a.lastUpdate = now;
            }
        }
    }

    getPath(a, t) {
        switch (a.type) {
            case 'morph': 
                if (a.frames) {
                    // Use pre-calculated frames
                    const idx = Math.floor(t * (a.frames.length - 1));
                    return a.frames[idx];
                }
                return this.morph(a.frames, t);
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
            const match = shape.match(/circle\(([^%]+)%\s+at\s+([^%]+)%\s+([^%]+)%\)/);
            if (match) {
                const [, r, x, y] = match.map(Number);
                return `circle(${(r * scale).toFixed(1)}% at ${x}% ${y}%)`;
            }
        }
        return shape;
    }

    star(t, pts, inner) {
        const rot = t * Math.PI * 2;
        const points = [];
        const step = Math.PI / pts;
        
        for (let i = 0; i < pts * 2; i++) {
            const angle = i * step + rot;
            const radius = i % 2 === 0 ? 50 : 50 * inner;
            const x = 50 + radius * Math.cos(angle);
            const y = 50 + radius * Math.sin(angle);
            points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
        }
        return `polygon(${points.join(', ')})`;
    }

    wave(t, amp, freq) {
        const points = [];
        const res = 10; // Reduced resolution for better performance
        const step = 100 / res;
        
        for (let i = 0; i <= res; i++) {
            const x = i * step;
            const y = 50 + Math.sin((i / res) * freq * Math.PI * 2 + t * Math.PI * 2) * amp;
            points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
        }
        points.push('100% 100%', '0% 100%');
        return `polygon(${points.join(', ')})`;
    }

    lerp(from, to, t) {
        // Cache regex for better performance
        if (!this.polyRegex) this.polyRegex = /polygon\(([^)]+)\)/;
        
        const fromMatch = from.match(this.polyRegex);
        const toMatch = to.match(this.polyRegex);
        
        if (!fromMatch || !toMatch) return t < 0.5 ? from : to;
        
        const fromPts = fromMatch[1].split(',').map(p => p.trim().split(/\s+/).map(parseFloat));
        const toPts = toMatch[1].split(',').map(p => p.trim().split(/\s+/).map(parseFloat));
        
        const maxPts = Math.max(fromPts.length, toPts.length);
        const interpolated = [];
        
        for (let i = 0; i < maxPts; i++) {
            const fp = fromPts[i % fromPts.length] || [0, 0];
            const tp = toPts[i % toPts.length] || [0, 0];
            const x = fp[0] + (tp[0] - fp[0]) * t;
            const y = fp[1] + (tp[1] - fp[1]) * t;
            interpolated.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
        }
        return `polygon(${interpolated.join(', ')})`;
    }

    connect() {
        this.ws = new WebSocket('ws://localhost:8765');
        this.ws.onopen = () => this.updateStatus('connected', 'Connected');
        this.ws.onclose = () => { 
            this.updateStatus('disconnected', 'Disconnected'); 
            setTimeout(() => this.connect(), 3000); 
        };
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
            
            // Batch DOM updates
            const pos = marker.position;
            const rot = marker.rotation;
            pos.set(-data.position.x * 3200 + 200, -data.position.y * 1500 + 250, -data.position.z * 100);
            rot.set(data.rotation.x * Math.PI/180, data.rotation.y * Math.PI/180, data.rotation.z * Math.PI/180);
            marker.visible = true;
            
            // Volume control based on Y position
            const player = this.players.get(id);
            if (player && player.setVolume) {
                // Convert screen position to volume (0-100)
                // The Y position ranges from roughly -750 to +750 (based on your transform)
                // Bottom of screen (positive Y) = 0 volume, Top of screen (negative Y) = 100 volume
                const screenY = -data.position.y * 1500 + 250; // This matches your position transform
                
                // Normalize to 0-1 range, then scale to 0-100
                // Adjust these values based on your actual camera tracking range
                const minY = -500; // Top of tracking area (100% volume)
                const maxY = 500;  // Bottom of tracking area (0% volume)
                
                // Clamp and normalize the Y position
                const clampedY = Math.max(minY, Math.min(maxY, screenY));
                const normalizedY = (clampedY - minY) / (maxY - minY); // 0 = top, 1 = bottom
                const volume = Math.round((1 - normalizedY) * 100); // Invert so top = 100%, bottom = 0%
                
                // Only update volume if it has changed significantly (reduces API calls)
                if (!marker.lastVolume || Math.abs(marker.lastVolume - volume) >= 5) {
                    player.setVolume(volume);
                    marker.lastVolume = volume;
                    
                    // Optional: log volume changes for debugging
                    // console.log(`Marker ${id}: Y=${screenY.toFixed(0)}, Volume=${volume}%`);
                }
            }
        });
    }

    updateStatus(className, text) {
        const conn = document.getElementById('conn');
        if (conn) { conn.className = className; conn.textContent = text; }
    }

    updateCounts(markers) {
        // Batch DOM updates
        requestAnimationFrame(() => {
            document.getElementById('markers').textContent = markers;
            document.getElementById('players').textContent = this.players.size;
        });
    }

    resize() {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
    }

    cleanup() {
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
        }
        this.anims.clear();
        this.players.clear();
        this.markers.clear();
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
    stop: (id) => ar.anims.delete(id),
    fps: (fps) => { ar.FPS = fps; ar.frameInterval = 1000 / fps; }
};

// Performance monitoring
window.perf = {
    monitor: () => {
        let lastTime = performance.now();
        let frames = 0;
        setInterval(() => {
            const now = performance.now();
            const fps = Math.round(1000 / (now - lastTime) * frames);
            console.log(`FPS: ${fps}, Animations: ${ar.anims.size}`);
            lastTime = now;
            frames = 0;
        }, 1000);
        
        const loop = () => {
            frames++;
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
};