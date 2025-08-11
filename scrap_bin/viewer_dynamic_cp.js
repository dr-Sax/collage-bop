class Viewer {
    constructor() {
        this.ws = null;
        this.markers = new Map();
        this.players = new Map();
        this.anims = new Map();
        this.config = null;
        this.animFrame = null;
        
        // Performance tracking
        this.lastUpdateTime = 0;
        this.updateCount = 0;
        this.fpsStartTime = Date.now();
        this.frameSkipCount = 0;
        this.lastFrameTime = 0;
        
        // Interpolation for smooth movement
        this.targetPositions = new Map();
        this.targetRotations = new Map();
        this.interpolationSpeed = 0.15;

        // MIDI Control System
        this.midiValues = new Map();
        this.markerControls = new Map();
        this.selectedMarkers = new Set();
        this.currentDialMarker = null;
        this.dialPosition = 0; // Track current dial position (0-127)
    }

    async init() {
        document.getElementById('loading').style.display = 'block';
        await this.loadYT();
        await this.loadConfig();
        await this.waitFor(() => THREE.CSS3DRenderer);
        
        this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 1000);
        this.scene = new THREE.Scene();
        this.renderer = new THREE.CSS3DRenderer();
        this.renderer.setSize(innerWidth, innerHeight);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        document.getElementById('container').appendChild(this.renderer.domElement);
        
        this.connect();
        this.setupEventListeners();
        this.animate();
        document.getElementById('loading').style.display = 'none';
    }

    setupEventListeners() {
        addEventListener('resize', () => {
            this.camera.aspect = innerWidth / innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(innerWidth, innerHeight);
        });
        
        // Fullscreen shortcut
        addEventListener('keydown', e => {
            if (e.key === 'f' && e.ctrlKey) {
                e.preventDefault();
                document.documentElement.requestFullscreen();
            }
        });

        // Add MIDI setup
        this.setupMIDI();
    }

    async loadYT() {
        return new Promise(resolve => {
            if (window.YT?.Player) return resolve();
            window.onYouTubeIframeAPIReady = resolve;
            if (!document.querySelector('script[src*="youtube.com"]')) {
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }
        });
    }

    async loadConfig() {
        try {
            this.config = await fetch('marker_config.json').then(r => r.json());
        } catch {
            this.config = {
                markers: {},
                default: {
                    width: "256px",
                    height: "144px",
                    src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
                    clip_path: "circle(50% at 50% 50%)"
                }
            };
        }
    }

    async waitFor(fn) {
        return new Promise(resolve => {
            const check = () => fn() ? resolve() : setTimeout(check, 100);
            check();
        });
    }

    createMarker(id) {
        const cfg = this.config.markers[id] || this.config.default;
        const vid = cfg.src.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/)?.[1];
        const container = document.createElement('div');
        
        // Smaller default sizes for better performance
        container.style.cssText = `
            width:${cfg.width};
            height:${cfg.height};
            clip-path:${cfg.clip_path};
            overflow:hidden;
            position:relative;
            transform:translateZ(0);
            will-change:transform;
        `;
        
        if (vid) {
            const playerDiv = document.createElement('div');
            playerDiv.id = `player-${id}`;
            playerDiv.style.cssText = 'width:100%;height:100%';
            container.appendChild(playerDiv);
            
            // Delayed player creation to prevent blocking
            setTimeout(() => {
                const player = new YT.Player(playerDiv.id, {
                    videoId: vid,
                    width: '100%',
                    height: '100%',
                    playerVars: {
                        autoplay: 1,
                        loop: 1,
                        mute: 0,
                        controls: 0,
                        rel: 0,
                        showinfo: 0,
                        modestbranding: 1,
                        playsinline: 1
                    },
                    events: {
                        onReady: e => {
                            e.target.setVolume(30); // Lower default volume
                            if (cfg.start) e.target.seekTo(cfg.start);
                            e.target.playVideo();
                        },
                        onStateChange: e => {
                            if (e.data === YT.PlayerState.PLAYING && cfg.start !== undefined && cfg.end !== undefined) {
                                const checkTime = () => {
                                    if (e.target.getCurrentTime() >= cfg.end) {
                                        e.target.seekTo(cfg.start);
                                    }
                                    if (e.target.getPlayerState() === YT.PlayerState.PLAYING) {
                                        setTimeout(checkTime, 200); // Less frequent checking
                                    }
                                };
                                checkTime();
                            }
                        }
                    }
                });
                this.players.set(id, player);
            }, 50);
        }
        
        if (cfg.anim && Object.keys(cfg.anim).length) {
            this.startAnim(container, id, cfg.anim);
        } else {
            setTimeout(() => container.style.clipPath = cfg.clip_path, 50);
        }
        
        const object = new THREE.CSS3DObject(container);
        
        // Initialize interpolation targets
        this.targetPositions.set(id, { x: 0, y: 0, z: 0 });
        this.targetRotations.set(id, { x: 0, y: 0, z: 0 });
        
        return object;
    }

    startAnim(container, id, cfg) {
        this.anims.set(id, { container, ...cfg, start: Date.now(), lastUpdate: 0 });
    }

    updateMarkerPosition(marker, data) {
        const id = data.id;
        
        // Set target positions for interpolation
        this.targetPositions.set(id, {
            x: -data.position.x * 3200 + 200,
            y: data.position.y * 1500 + 250,
            z: -data.position.z * 100
        });
        
        this.targetRotations.set(id, {
            x: data.rotation.x * Math.PI/180,
            y: data.rotation.y * Math.PI/180,
            z: data.rotation.z * Math.PI/180
        });
        
        marker.visible = true;
        
        // Volume control with debouncing
        const player = this.players.get(id);
        if (player?.setVolume) {
            const rotZ = Math.abs(data.rotation.z) % 360;
            const volume = Math.round(rotZ / 360 * 50); // Max 50% volume
            if (!marker.lastVolume || Math.abs(marker.lastVolume - volume) >= 10) {
                player.setVolume(volume);
                marker.lastVolume = volume;
            }
        }

        // In your marker update loop, when a marker becomes invisible:
        if (!marker.visible && this.selectedMarkers.has(id)) {
            this.cleanupMarkerSelection(id);
        }
    }


    ///////////////////////////////////////////////////////////////////////////////////////
    // MIDI Control System
    ///////////////////////////////////////////////////////////////////////////////////////
    async setupMIDI() {
        // Check for Web MIDI API support
        if (!navigator.requestMIDIAccess) {
            console.warn('❌ Web MIDI API not supported in this browser');
            return;
        }
        
        try {
            const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            
            if (midiAccess.inputs.size === 0) {
                console.warn('🎹 No MIDI input devices found');
                return;
            }
            
            this.setupMIDIInputs(midiAccess);
            
        } catch (error) {
            console.warn('❌ MIDI access denied or failed:', error);
        }
    }

    setupMIDIInputs(midiAccess) {
        // Set up all currently connected inputs
        for (const input of midiAccess.inputs.values()) {
            this.setupMIDIInput(input);
        }
    }

    setupMIDIInput(input) {
        console.log(`🎹 Setting up MIDI input: ${input.name}`);
        
        // This is the event listener setup
        input.onmidimessage = (message) => {
            this.handleMIDIMessage(message);
        };
    }

    handleMIDIMessage(message) {
        const [command, cc, value] = message.data;
        
        // Filter for Control Change messages (176 = 0xB0)
        if (command === 176) {
            this.processMIDIControl(cc, value);
        }
        
        // Handle Note On/Off for drum pads (144/128)
        else if (command === 144 || command === 128) {
            this.processMIDINote(message.data[1], message.data[2], command === 144);
        }
    }

    handleMarkerSelection(value) {
        this.dialPosition = value;
        
        // Get array of visible marker IDs
        const visibleMarkerIds = Array.from(this.markers.keys()).filter(id => {
            const marker = this.markers.get(id);
            return marker && marker.visible;
        });
        
        if (visibleMarkerIds.length === 0) {
            this.currentDialMarker = null;
            return;
        }
        
        // Add +1 for the "null" selection position
        const totalPositions = visibleMarkerIds.length + 1;
        
        // Map MIDI value (0-127) to total positions (including null)
        const position = Math.floor((value / 127) * totalPositions);
        const clampedPosition = Math.min(position, totalPositions - 1);
        
        // Remove highlight from previous dial selection
        if (this.currentDialMarker !== null) {
            this.removeDialHighlight(this.currentDialMarker);
        }
        
        // Check if we're in the "null" position (first position)
        if (clampedPosition === 0) {
            this.currentDialMarker = null;
            console.log(`🎹 Dial in null position (no marker selected)`);
            return;
        }
        
        // Get the actual marker (subtract 1 because position 0 is null)
        const markerIndex = clampedPosition - 1;
        const newSelectedId = visibleMarkerIds[markerIndex];
        
        // Set new dial selection
        this.currentDialMarker = newSelectedId;
        
        // Add highlight to new selection (only if not already selected)
        if (!this.selectedMarkers.has(newSelectedId)) {
            this.addDialHighlight(newSelectedId);
        }
        
        console.log(`🎹 Dial hovering marker ${newSelectedId} (${markerIndex + 1}/${visibleMarkerIds.length})`);
    }

addDialHighlight(markerId) {
    const marker = this.markers.get(markerId);
    if (!marker) {
        console.log(`❌ No marker found for ID ${markerId}`);
        return;
    }
    
    const container = marker.element;
    console.log(`🔍 Adding highlight to:`, container);
    
    // Create or update border overlay
    let borderOverlay = container.querySelector('.dial-highlight');
    if (!borderOverlay) {
        borderOverlay = document.createElement('div');
        borderOverlay.className = 'dial-highlight';
        container.appendChild(borderOverlay);
        console.log(`✅ Created border overlay for marker ${markerId}`);
    }
    
    // Style the border to match the clip path
    const config = this.config.markers[markerId] || this.config.default;
    console.log(`🎨 Using clip path: ${config.clip_path}`);
    
    borderOverlay.style.cssText = `
        position: absolute;
        top: -3px;
        left: -3px;
        width: calc(100% + 6px);
        height: calc(100% + 6px);
        border: 3px solid #ff6b35;
        clip-path: ${config.clip_path};
        pointer-events: none;
        z-index: 10;
        box-sizing: border-box;
        background: rgba(241, 241, 86, 0.8);
    `;
    
    console.log(`🎨 Applied styles to border overlay`);
}

    removeDialHighlight(markerId) {
        const marker = this.markers.get(markerId);
        if (!marker) return;
        
        const borderOverlay = marker.element.querySelector('.dial-highlight');
        if (borderOverlay) {
            borderOverlay.remove();
        }
    }

    addSelectionHighlight(markerId) {
        const marker = this.markers.get(markerId);
        if (!marker) return;
        
        const container = marker.element;
        
        // Create or update selection border
        let selectionOverlay = container.querySelector('.selection-highlight');
        if (!selectionOverlay) {
            selectionOverlay = document.createElement('div');
            selectionOverlay.className = 'selection-highlight';
            container.appendChild(selectionOverlay);
        }
        
        // Yellow border for selected items
        const config = this.config.markers[markerId] || this.config.default;
        selectionOverlay.style.cssText = `
            position: absolute;
            top: -3px;
            left: -3px;
            width: calc(100% + 6px);
            height: calc(100% + 6px);
            border: 3px solid #ffff00;
            clip-path: ${config.clip_path};
            pointer-events: none;
            z-index: 11;
            box-sizing: border-box;
        `;
    }

    removeSelectionHighlight(markerId) {
        const marker = this.markers.get(markerId);
        if (!marker) return;
        
        const selectionOverlay = marker.element.querySelector('.selection-highlight');
        if (selectionOverlay) {
            selectionOverlay.remove();
        }
    }

    toggleMarkerSelection() {
        if (this.currentDialMarker === null) return;
        
        const markerId = this.currentDialMarker;
        
        if (this.selectedMarkers.has(markerId)) {
            // Deselect
            this.selectedMarkers.delete(markerId);
            this.removeSelectionHighlight(markerId);
            
            // Restore dial highlight if this marker is still under the dial
            this.addDialHighlight(markerId);
            
            console.log(`🎹 Deselected marker ${markerId}`);
        } else {
            // Select
            this.selectedMarkers.add(markerId);
            this.removeDialHighlight(markerId); // Remove red highlight
            this.addSelectionHighlight(markerId); // Add yellow highlight
            
            console.log(`🎹 Selected marker ${markerId}`);
        }
        
        // Initialize control values for newly selected marker
        if (this.selectedMarkers.has(markerId) && !this.markerControls.has(markerId)) {
            this.markerControls.set(markerId, {
                scale: 1.0,
                alpha: 1.0,
                red: 255,
                green: 255,
                blue: 255,
                zOffset: 0,
                rotationX: 0,
                rotationY: 0
            });
        }
    }

    // Call this when a marker is removed/becomes invisible
    cleanupMarkerSelection(markerId) {
        // Remove from selections
        this.selectedMarkers.delete(markerId);
        
        // Clear dial selection if this was it
        if (this.currentDialMarker === markerId) {
            this.currentDialMarker = null;
        }
        
        // Remove any highlight overlays
        this.removeDialHighlight(markerId);
        this.removeSelectionHighlight(markerId);
    }

    processMIDIControl(cc, value) {
        // Store the raw MIDI value
        this.midiValues.set(cc, value);
        
        switch(cc) {
            case 70: // Selection dial
                this.handleMarkerSelection(value);
                break;
            case 71: // Red
            case 72: // Green  
            case 73: // Blue
            case 74: // Alpha
                this.handleColorControl(cc, value);
                break;
            case 75: // Scale
                this.handleScaleControl(value);
                break;
            case 76: // Z-position
                this.handleZPositionControl(value);
                break;
            case 77: // X rotation
            case 78: // Y rotation
                this.handleRotationControl(cc, value);
                break;
            default:
                console.log(`🎹 Unmapped CC ${cc}: ${value}`);
        }
    }

    processMIDINote(note, velocity, isNoteOn) {
        if (note === 36 && isNoteOn && velocity > 0) { // Drum pad
            this.toggleMarkerSelection();
        }
    }
    //////////////////////////////////////////////////////////////////////////////////////

    applyMarkerControls(id, marker) {
        const controls = this.markerControls.get(id);
        if (!controls || !this.selectedMarkers.has(id)) return;
        
        // Apply scale, additional rotations, transparency, etc.
        // These modify the marker AFTER tracking positions are set
    }

    interpolateMarkers() {
        // Smooth interpolation for all markers
        for (const [id, marker] of this.markers) {
            const targetPos = this.targetPositions.get(id);
            const targetRot = this.targetRotations.get(id);
            
            if (targetPos && targetRot) {
                // Lerp position
                marker.position.x += (targetPos.x - marker.position.x) * this.interpolationSpeed;
                marker.position.y += (targetPos.y - marker.position.y) * this.interpolationSpeed;
                marker.position.z += (targetPos.z - marker.position.z) * this.interpolationSpeed;
                
                // Lerp rotation
                marker.rotation.x += (targetRot.x - marker.rotation.x) * this.interpolationSpeed;
                marker.rotation.y += (targetRot.y - marker.rotation.y) * this.interpolationSpeed;
                marker.rotation.z += (targetRot.z - marker.rotation.z) * this.interpolationSpeed;
            }
        }
    }

    updatePerformanceStats(processingTime) {
        const now = Date.now();
        this.updateCount++;
        
        // Calculate update rate every second
        if (now - this.fpsStartTime >= 1000) {
            const fps = this.updateCount;
            document.getElementById('update-rate').textContent = `${fps} fps`;
            document.getElementById('update-rate').className = 
                fps >= 25 ? 'performance-good' : fps >= 15 ? 'performance-warning' : 'performance-bad';
            
            this.updateCount = 0;
            this.fpsStartTime = now;
        }
        
        // Update processing time
        if (processingTime !== undefined) {
            const procTime = Math.round(processingTime * 1000);
            document.getElementById('processing-time').textContent = `${procTime}ms`;
            document.getElementById('processing-time').className = 
                procTime <= 10 ? 'performance-good' : procTime <= 25 ? 'performance-warning' : 'performance-bad';
        }
    }

    animate() {
        const now = Date.now();
        const deltaTime = now - this.lastFrameTime;
        
        // Frame rate limiting for consistency
        if (deltaTime >= 16) { // ~60fps max
            // Animate clip paths
            for (const [id, a] of this.anims) {
                if (now - a.lastUpdate < 32) continue; // ~30fps for animations
                const t = ((now - a.start) % (a.dur * 1000)) / (a.dur * 1000);
                const path = this.getPath(a, t);
                if (a.lastPath !== path) {
                    a.container.style.clipPath = path;
                    a.lastPath = path;
                    a.lastUpdate = now;
                }
            }
            
            // Interpolate marker positions
            this.interpolateMarkers();
            
            this.renderer.render(this.scene, this.camera);
            this.lastFrameTime = now;
        } else {
            this.frameSkipCount++;
        }
        
        this.animFrame = requestAnimationFrame(() => this.animate());
    }

    getPath(a, t) {
        switch (a.type) {
            case 'morph': return this.morph(a.frames, t);
            case 'breathe':
                const s = 1 + Math.sin(t * Math.PI * 2) * (a.amp || 0.3);
                const m = a.shape.match(/circle\(([^%]+)%\s+at\s+([^%]+)%\s+([^%]+)%\)/);
                return m ? `circle(${(m[1] * s).toFixed(1)}% at ${m[2]}% ${m[3]}%)` : a.shape;
            case 'star':
                const rot = t * Math.PI * 2;
                const pts = [];
                const step = Math.PI / (a.pts || 5);
                for (let i = 0; i < (a.pts || 5) * 2; i++) {
                    const angle = i * step + rot;
                    const radius = i % 2 === 0 ? 50 : 50 * (a.inner || 0.4);
                    pts.push(`${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`);
                }
                return `polygon(${pts.join(', ')})`;
            default: return a.frames?.[0] || 'circle(50% at 50% 50%)';
        }
    }

    morph(frames, t) {
        const idx = Math.floor(t * (frames.length - 1));
        const next = Math.min(idx + 1, frames.length - 1);
        const prog = (t * (frames.length - 1)) - idx;
        return this.lerp(frames[idx], frames[next], prog);
    }

    lerp(from, to, t) {
        const regex = /polygon\(([^)]+)\)/;
        const fromMatch = from.match(regex);
        const toMatch = to.match(regex);
        if (!fromMatch || !toMatch) return t < 0.5 ? from : to;
        
        const fromPts = fromMatch[1].split(',').map(p => p.trim().split(/\s+/).map(parseFloat));
        const toPts = toMatch[1].split(',').map(p => p.trim().split(/\s+/).map(parseFloat));
        const maxPts = Math.max(fromPts.length, toPts.length);
        const result = [];
        
        for (let i = 0; i < maxPts; i++) {
            const fp = fromPts[i % fromPts.length] || [0, 0];
            const tp = toPts[i % toPts.length] || [0, 0];
            result.push(`${(fp[0] + (tp[0] - fp[0]) * t).toFixed(1)}% ${(fp[1] + (tp[1] - fp[1]) * t).toFixed(1)}%`);
        }
        return `polygon(${result.join(', ')})`;
    }

    connect() {
        try {
            this.ws = new WebSocket('ws://localhost:8765');
            
            this.ws.onopen = () => {
                document.getElementById('conn').className = 'connected';
                document.getElementById('conn').textContent = 'Connected';
                console.log('🔗 Connected to tracker');
            };
            
            this.ws.onclose = () => {
                document.getElementById('conn').className = 'disconnected';
                document.getElementById('conn').textContent = 'Disconnected';
                console.log('❌ Disconnected from tracker');
                setTimeout(() => this.connect(), 3000);
            };
            
            this.ws.onmessage = e => {
                try {
                    const data = JSON.parse(e.data);
                    const now = Date.now();
                    
                    if (data.type === 'tracking_update') {
                        const markers = data.markers || {};
                        
                        // Update markers
                        Object.entries(markers).forEach(([id, markerData]) => {
                            id = parseInt(id);
                            if (!this.markers.has(id)) {
                                const el = this.createMarker(id);
                                this.group.add(el);
                                this.markers.set(id, el);
                            }
                            this.updateMarkerPosition(this.markers.get(id), markerData);
                        });
                        
                        // Update status
                        document.getElementById('markers').textContent = Object.keys(markers).length;
                        document.getElementById('players').textContent = this.players.size;
                        
                        // Calculate network lag
                        const networkLag = now - (data.timestamp * 1000);
                        document.getElementById('network-lag').textContent = `${Math.round(networkLag)}ms`;
                        document.getElementById('network-lag').className = 
                            networkLag <= 50 ? 'performance-good' : networkLag <= 100 ? 'performance-warning' : 'performance-bad';
                        
                        this.updatePerformanceStats(data.processing_time);
                    }
                } catch (err) {
                    console.error('❌ Message parsing error:', err);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };
            
        } catch (err) {
            console.error('❌ Connection error:', err);
            setTimeout(() => this.connect(), 3000);
        }
    }
}

document.getElementById('start-button').onclick = async () => {
    document.getElementById('start-screen').style.display = 'none';
    window.ar = new Viewer();
    await window.ar.init();
    
    // Global controls for debugging
    window.controls = {
        vol: (id, v) => ar.players.get(id)?.setVolume(v),
        mute: (id) => ar.players.get(id)?.mute(),
        play: (id) => ar.players.get(id)?.playVideo(),
        pause: (id) => ar.players.get(id)?.pauseVideo(),
        stats: () => console.log({
            markers: ar.markers.size,
            players: ar.players.size,
            anims: ar.anims.size,
            frameSkips: ar.frameSkipCount
        })
    };
};