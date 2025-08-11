export class YouTubeManager {
    constructor() {
        this.apiReady = false;
    }

    async loadAPI() {
        return new Promise(resolve => {
            if (window.YT?.Player) {
                this.apiReady = true;
                return resolve();
            }
            
            window.onYouTubeIframeAPIReady = () => {
                this.apiReady = true;
                resolve();
            };
            
            if (!document.querySelector('script[src*="youtube.com"]')) {
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }
        });
    }

    extractVideoId(url) {
        const match = url.match(/(?:embed\/|youtu\.be\/|watch\?v=)([^&\n?#]+)/);
        return match ? match[1] : null;
    }

    isAPIReady() {
        return this.apiReady;
    }
}