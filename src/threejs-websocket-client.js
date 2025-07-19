
class ARTracker {
    constructor() {
        this.ws = null;
        this.markers = new Map();
        this.players = new Map();
        this.config = null;
        
        this.loadYouTube().then(() => this.loadConfig().then(() => this.init()));
    }

    async loadYouTube() {
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
            this.config = { markers: {}, default: { width: "512px", height: "288px", src: "https://www.youtube.com/embed/dQw4w9WgXcQ", clip_path: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)" }};
        }
    }

    init() {
        // Setup Three.js
        this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 1000);
        this.scene = new THREE.Scene();
        this.renderer = new THREE.CSS3DRenderer();
        this.renderer.setSize(innerWidth, innerHeight);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        document.getElementById('container').appendChild(this.renderer.domElement);

        // Setup WebSocket
        this.connect();
        
        // Start animation
        addEventListener('resize', () => this.resize());
        this.animate();
    }

    extractVideoId(url) {
        return url.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/)?.[1];
    }

    createMarker(id) {
        const config = this.config.markers[id.toString()] || this.config.default;
        const videoId = this.extractVideoId(config.src);
        
        console.log(`🎬 Creating marker ${id} with video ${videoId}`);
        
        // Create container with clip path
        const container = document.createElement('div');
        container.style.cssText = `
            width: ${config.width}; height: ${config.height};
            clip-path: ${config.clip_path}; overflow: hidden; position: relative;
        `;
        
        // Create YouTube player div
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${id}`;
        playerDiv.style.cssText = 'width: 100%; height: 100%;';
        container.appendChild(playerDiv);
        
        // Create YouTube player with delay (like debug version)
        if (videoId) {
            setTimeout(() => {
                try {
                    console.log(`🎥 Creating YouTube player for marker ${id}`);
                    const player = new YT.Player(playerDiv.id, {
                        videoId,
                        width: '100%',
                        height: '100%',
                        playerVars: { 
                            autoplay: 1, 
                            loop: 1, 
                            mute: 1, 
                            controls: 0, 
                            playlist: videoId, 
                            rel: 0,
                            showinfo: 0
                        },
                        events: { 
                            onReady: (event) => {
                                console.log(`✅ YouTube player ${id} ready`);
                                event.target.playVideo();
                            },
                            onError: (event) => {
                                console.error(`❌ YouTube player ${id} error:`, event.data);
                            }
                        }
                    });
                    this.players.set(id, player);
                } catch (error) {
                    console.error(`❌ Failed to create player for marker ${id}:`, error);
                }
            }, 100);
        }
        
        console.log(`📺 Marker ${id} element created`);
        return new THREE.CSS3DObject(container);
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
            marker.position.set(
                -data.position.x * 3200 + 200,
                -data.position.y * 1500 + 250,
                -data.position.z * 100
            );
            marker.rotation.set(
                data.rotation.x * Math.PI/180,
                data.rotation.y * Math.PI/180,
                data.rotation.z * Math.PI/180
            );
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

    // Simple controls
    setVolume(id, vol) { this.players.get(id)?.setVolume(vol); }
    mute(id) { this.players.get(id)?.mute(); }
    unmute(id) { this.players.get(id)?.unMute(); }
    play(id) { this.players.get(id)?.playVideo(); }
    pause(id) { this.players.get(id)?.pauseVideo(); }
    seek(id, time) { this.players.get(id)?.seekTo(time); }
}

// Global controls
window.ar = new ARTracker();
window.controls = {
    volume: (id, vol) => ar.setVolume(id, vol),
    mute: (id) => ar.mute(id),
    unmute: (id) => ar.unmute(id),
    play: (id) => ar.play(id),
    pause: (id) => ar.pause(id),
    seek: (id, time) => ar.seek(id, time)
};
