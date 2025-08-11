// Custom A-Frame components for video clipping functionality

// Register custom clipped-plane (non-rectangular video) geometry
AFRAME.registerGeometry('clipped-plane', {
  schema: {
    width: {type: 'number', default: 1},
    height: {type: 'number', default: 1},
    points: {type: 'array', default: []}
  },
  init: function (data) {
      const geometry = new THREE.BufferGeometry();
      let vertices = [];
      let uvs = [];
      let indices = [];
    
      // Convert percentage points to world coordinates
      for (let i = 0; i < data.points.length; i += 2) {
          const xPercent = data.points[i] / 100;
          const yPercent = data.points[i + 1] / 100;
          
          // Convert from percentage (0-100) to world coordinates
          const x = (xPercent - 0.5) * data.width;
          const y = (0.5 - yPercent) * data.height; // Flip Y for correct orientation
          
          vertices.push(x, y, 0);
          uvs.push(xPercent, 1 - yPercent); // UV coordinates for texture mapping
      }
      
      // Create triangular faces using fan triangulation from first vertex
      for (let i = 1; i < vertices.length / 3 - 1; i++) {
          indices.push(0, i, i + 1);
      }
  
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      
      this.geometry = geometry;
  }
});

// Custom component to use clipped geometry with point arrays
AFRAME.registerComponent('video-clip', {
  schema: {
    points: {type: 'string', default: ''},
    src: {type: 'string'}
  },
  init: function () {
    const el = this.el;
    const data = this.data;
    
    // Parse points string into array
    let pointsArray = [];
    if (data.points) {
      pointsArray = data.points.split(',').map(p => parseFloat(p.trim()));
    }
    
    // Remove existing geometry and material
    el.removeAttribute('geometry');
    el.removeAttribute('material');
    
    // Set new clipped geometry
    el.setAttribute('geometry', {
      primitive: 'clipped-plane',
      width: 1,                 // these need to be passed in through as attributes instead of hardcoded
      height: 0.5367746288798919,
      points: pointsArray
    });
    
    // Set material with video texture
    el.setAttribute('material', {
      shader: 'standard',
      src: data.src,
      side: 'double',
      transparent: true,
      opacity: 0.5
    });
    
    // Ensure video plays
    this.setupVideo();
  },
  
  setupVideo: function() {
    const data = this.data;
    const videoSelector = data.src;
    
    // Wait for the scene to load
    this.el.sceneEl.addEventListener('loaded', () => {
      const videoEl = document.querySelector(videoSelector);
      if (videoEl) {
        // Force video to load and play
        videoEl.load();
        
        const playVideo = () => {
          const playPromise = videoEl.play();
          if (playPromise !== undefined) {
            playPromise.catch(error => {
              console.log('Video autoplay prevented:', error);
              // Add click handler to start video on user interaction
              document.addEventListener('click', () => {
                videoEl.play().catch(e => console.log('Video play failed:', e));
              }, { once: true });
              
              document.addEventListener('touchstart', () => {
                videoEl.play().catch(e => console.log('Video play failed:', e));
              }, { once: true });
            });
          }
        };
        
        if (videoEl.readyState >= 2) {
          playVideo();
        } else {
          videoEl.addEventListener('canplay', playVideo, { once: true });
        }
      }
    });
  }
});

// Component to track marker position and rotation changes
AFRAME.registerComponent('marker-tracker', {
  schema: {
    targetIndex: {type: 'int', default: 0},
    name: {type: 'string', default: 'marker'}
  },
  
  init: function() {
    this.lastPosition = new THREE.Vector3();
    this.lastRotation = new THREE.Euler();
    this.isTracking = false;
    this.logCounter = 0;
    
    // Listen for target found/lost events
    this.el.addEventListener('targetFound', this.onTargetFound.bind(this));
    this.el.addEventListener('targetLost', this.onTargetLost.bind(this));
  },
  
  onTargetFound: function() {
    this.isTracking = true;
    this.logCounter = 0;
    console.log(`🎯 Marker ${this.data.targetIndex} (${this.data.name}) - TARGET FOUND`);
    this.logPosition();
  },
  
  onTargetLost: function() {
    this.isTracking = false;
    console.log(`❌ Marker ${this.data.targetIndex} (${this.data.name}) - TARGET LOST`);
  },
  
  tick: function() {
    if (!this.isTracking) return;
    
    // Get the actual world position and rotation from Three.js object
    const object3D = this.el.object3D;
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    
    // Get world matrix decomposition
    object3D.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
    
    // Convert quaternion to Euler angles (in degrees)
    const worldRotation = new THREE.Euler().setFromQuaternion(worldQuaternion);
    const rotationDegrees = {
      x: THREE.MathUtils.radToDeg(worldRotation.x),
      y: THREE.MathUtils.radToDeg(worldRotation.y),
      z: THREE.MathUtils.radToDeg(worldRotation.z)
    };
    
    // Check if position or rotation has changed significantly
    const positionChanged = worldPosition.distanceTo(this.lastPosition) > 0.01;
    const rotationChanged = Math.abs(rotationDegrees.x - this.lastRotation.x) > 1 ||
                           Math.abs(rotationDegrees.y - this.lastRotation.y) > 1 ||
                           Math.abs(rotationDegrees.z - this.lastRotation.z) > 1;
    
    // Log every 30 frames (about every 0.5 seconds) or when significant change occurs
    this.logCounter++;
    if (positionChanged || rotationChanged || this.logCounter >= 30) {
      this.logPosition(worldPosition, rotationDegrees);
      this.lastPosition.copy(worldPosition);
      this.lastRotation.set(rotationDegrees.x, rotationDegrees.y, rotationDegrees.z);
      this.logCounter = 0;
    }
  },
  
  logPosition: function(position, rotation) {
    // If no parameters passed, get them from the object
    if (!position || !rotation) {
      const object3D = this.el.object3D;
      const worldPosition = new THREE.Vector3();
      const worldQuaternion = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      
      object3D.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
      const worldRotation = new THREE.Euler().setFromQuaternion(worldQuaternion);
      
      position = worldPosition;
      rotation = {
        x: THREE.MathUtils.radToDeg(worldRotation.x),
        y: THREE.MathUtils.radToDeg(worldRotation.y),
        z: THREE.MathUtils.radToDeg(worldRotation.z)
      };
    }
    
    console.log(`📍 Marker ${this.data.targetIndex} (${this.data.name}):`);
    console.log(`   Position: x=${position.x.toFixed(3)}, y=${position.y.toFixed(3)}, z=${position.z.toFixed(3)}`);
    console.log(`   Rotation: x=${rotation.x.toFixed(1)}°, y=${rotation.y.toFixed(1)}°, z=${rotation.z.toFixed(1)}°`);
    
    // Also log distance from camera for context
    const camera = document.querySelector('a-camera');
    if (camera) {
      const cameraPos = camera.object3D.position;
      const distance = position.distanceTo(cameraPos);
      console.log(`   Distance from camera: ${distance.toFixed(3)}`);
    }
  }
});

// Initialize videos when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Add user interaction handlers to start videos
  const startVideos = () => {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.play().catch(e => console.log('Video play failed:', e));
    });
  };
});