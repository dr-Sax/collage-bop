import cv2
import numpy as np
import asyncio
import websockets
import json
import time
import threading
from queue import Queue, Empty
from datetime import datetime

class OptimizedTracker:
    def __init__(self, config_file='marker_config.json'):
        # Camera Setup - optimized for speed
        self.cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)
        
        # More aggressive resolution optimization
        resolutions = [(320, 240), (424, 240), (640, 360), (640, 480)]
        best_resolution = (320, 240)  # Default fallback
        
        for width, height in resolutions:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            actual_w = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            actual_h = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            if actual_w == width and actual_h == height:
                best_resolution = (width, height)
                print(f"📷 Resolution set: {width}x{height}")
                break
        
        # Optimize camera settings for minimum latency
        self.cap.set(cv2.CAP_PROP_FPS, 90)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize buffering
        self.cap.set(cv2.CAP_PROP_EXPOSURE, -6)  # Lower exposure for less motion blur
        actual_fps = self.cap.get(cv2.CAP_PROP_FPS)
        print(f"🎯 Target FPS: 90, Actual: {actual_fps}")
        print(f"📏 Using resolution: {best_resolution[0]}x{best_resolution[1]}")
        
        self.clients = set()
        self.load_config(config_file)
        
        # ArUco - optimized detector
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_250)
        detector_params = cv2.aruco.DetectorParameters()
        # Speed optimizations
        detector_params.adaptiveThreshWinSizeMin = 3
        detector_params.adaptiveThreshWinSizeMax = 15
        detector_params.adaptiveThreshWinSizeStep = 4
        detector_params.minMarkerPerimeterRate = 0.01
        detector_params.maxMarkerPerimeterRate = 4.0
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, detector_params)
        
        # Camera calibration - adjusted for resolution
        width = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        self.camera_matrix = np.array([
            [width * 1.2, 0, width/2], 
            [0, height * 1.2, height/2], 
            [0, 0, 1]
        ], dtype=float)
        self.dist_coeffs = np.zeros((4,1))
        
        # Threading setup
        self.frame_queue = Queue(maxsize=1)  # Even smaller queue for lower latency
        self.result_queue = Queue(maxsize=5)
        self.running = False
        
        # Motion detection for frame skipping
        self.last_gray = None
        self.motion_threshold = 2000  # Adjust based on testing
        self.frame_skip_counter = 0
        self.max_frame_skip = 2  # Skip at most 2 frames during fast motion
        
        # Prediction system
        self.marker_velocities = {}
        self.prediction_alpha = 0.3  # Smoothing factor for velocity estimation
        
        # History tracking
        self.design_history = {}
        self.last_states = {}
        self.frame_count = 0
        self.fps_counter = 0
        self.fps_start_time = time.time()

    def load_config(self, config_file):
        try:
            with open(config_file, 'r') as f:
                self.config = json.load(f)
            print(f"✅ Config loaded: {list(self.config['markers'].keys())}")
        except Exception as e:
            print(f"❌ Config error: {e}")
            self.config = {
                'markers': {},
                'default': {
                    'width': '256px',
                    'height': '144px', 
                    'src': 'https://www.youtube.com/embed/dQw4w9WgXcQ',
                    'clip_path': 'circle(50% at 50% 50%)'
                }
            }

    def capture_thread(self):
        """Dedicated thread for frame capture with motion detection"""
        print("🎬 Capture thread started")
        frame_count = 0
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                continue
            
            frame_count += 1
            
            # Motion-based frame skipping
            should_process = True
            if frame_count > 1:  # Skip first frame for motion detection
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                
                if self.last_gray is not None:
                    # Calculate motion
                    diff = cv2.absdiff(self.last_gray, gray)
                    motion_amount = np.sum(diff)
                    
                    # Skip frames during high motion to reduce processing load
                    if motion_amount > self.motion_threshold:
                        self.frame_skip_counter += 1
                        if self.frame_skip_counter <= self.max_frame_skip:
                            should_process = False
                    else:
                        self.frame_skip_counter = 0
                
                self.last_gray = gray
            
            if should_process:
                # Drop old frames if queue is full
                while not self.frame_queue.empty():
                    try:
                        self.frame_queue.get_nowait()
                    except Empty:
                        break
                
                try:
                    self.frame_queue.put_nowait((time.time(), frame))
                except:
                    pass  # Queue full, drop frame
            
            time.sleep(0.003)  # Reduced delay for faster capture

    def process_thread(self):
        """Dedicated thread for marker detection"""
        print("🔍 Processing thread started")
        while self.running:
            try:
                timestamp, frame = self.frame_queue.get(timeout=0.1)
                markers = self.detect_markers(frame)
                
                # Put result with timestamp
                try:
                    self.result_queue.put_nowait({
                        'timestamp': timestamp,
                        'markers': markers,
                        'processing_time': time.time() - timestamp
                    })
                except:
                    pass  # Queue full, drop result
                    
            except Empty:
                continue
            except Exception as e:
                print(f"❌ Processing error: {e}")

    def detect_markers(self, frame):
        # Convert to grayscale once
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self.detector.detectMarkers(gray)
        markers = {}
        
        if ids is not None:
            # Batch process all markers
            object_points = np.array([
                [-0.025, -0.025, 0], [0.025, -0.025, 0], 
                [0.025, 0.025, 0], [-0.025, 0.025, 0]
            ], dtype=np.float32)
            
            for i, marker_id in enumerate(ids.flatten()):
                try:
                    success, rvec, tvec = cv2.solvePnP(
                        object_points, corners[i].reshape(-1, 2), 
                        self.camera_matrix, self.dist_coeffs
                    )
                    
                    if success:
                        # Fix NumPy scalar conversion warnings
                        rvec_flat = rvec.flatten()
                        tvec_flat = tvec.flatten()
                        
                        # Fast rotation conversion
                        R, _ = cv2.Rodrigues(rvec_flat)
                        markers[int(marker_id)] = {
                            'id': int(marker_id),
                            'position': {
                                'x': tvec_flat[0].item(), 
                                'y': tvec_flat[1].item(), 
                                'z': tvec_flat[2].item()
                            },
                            'rotation': {
                                'x': float(np.arctan2(R[2,1], R[2,2]) * 180/np.pi),
                                'y': float(np.arctan2(-R[2,0], np.sqrt(R[2,1]**2 + R[2,2]**2)) * 180/np.pi),
                                'z': float(np.arctan2(R[1,0], R[0,0]) * 180/np.pi)
                            }
                        }
                except Exception as e:
                    print(f"❌ Marker {marker_id} processing error: {e}")
                    continue
        
        return markers

    def predict_marker_positions(self, markers):
        """Predict marker positions based on velocity for smoother tracking"""
        current_time = time.time()
        predicted_markers = {}
        
        for marker_id, data in markers.items():
            if marker_id in self.last_states:
                last_data = self.last_states[marker_id]
                last_time = getattr(self, 'last_update_time', current_time - 0.033)
                dt = current_time - last_time
                
                if dt > 0 and dt < 0.1:  # Only predict for reasonable time deltas
                    # Calculate velocity
                    velocity = {
                        'x': (data['position']['x'] - last_data['position']['x']) / dt,
                        'y': (data['position']['y'] - last_data['position']['y']) / dt,
                        'z': (data['position']['z'] - last_data['position']['z']) / dt
                    }
                    
                    # Smooth velocity with previous estimate
                    if marker_id in self.marker_velocities:
                        old_vel = self.marker_velocities[marker_id]
                        velocity = {
                            'x': old_vel['x'] * (1 - self.prediction_alpha) + velocity['x'] * self.prediction_alpha,
                            'y': old_vel['y'] * (1 - self.prediction_alpha) + velocity['y'] * self.prediction_alpha,
                            'z': old_vel['z'] * (1 - self.prediction_alpha) + velocity['z'] * self.prediction_alpha
                        }
                    
                    self.marker_velocities[marker_id] = velocity
                    
                    # Predict future position (small time step ahead)
                    prediction_time = 0.02  # 20ms ahead
                    predicted_markers[marker_id] = {
                        **data,
                        'position': {
                            'x': data['position']['x'] + velocity['x'] * prediction_time,
                            'y': data['position']['y'] + velocity['y'] * prediction_time,
                            'z': data['position']['z'] + velocity['z'] * prediction_time
                        }
                    }
                else:
                    predicted_markers[marker_id] = data
            else:
                predicted_markers[marker_id] = data
        
        self.last_update_time = current_time
        return predicted_markers
    def should_update_history(self, markers):
        if len(markers) != len(self.last_states):
            return True
        
        for marker_id, data in markers.items():
            if marker_id not in self.last_states:
                return True
            
            last = self.last_states[marker_id]
            # Increased thresholds for fewer updates
            pos_change = sum(abs(data['position'][k] - last['position'][k]) for k in ['x', 'y', 'z'])
            rot_change = sum(abs(data['rotation'][k] - last['rotation'][k]) for k in ['x', 'y', 'z'])
            
            if pos_change > 0.015 or rot_change > 2.0:  # Higher thresholds
                return True
        return False

    def should_broadcast(self, markers):
        """Separate check for broadcasting - can be more frequent than history"""
        if len(markers) != len(self.last_states):
            return True
        
        for marker_id, data in markers.items():
            if marker_id not in self.last_states:
                return True
            
            last = self.last_states[marker_id]
            pos_change = sum(abs(data['position'][k] - last['position'][k]) for k in ['x', 'y', 'z'])
            rot_change = sum(abs(data['rotation'][k] - last['rotation'][k]) for k in ['x', 'y', 'z'])
            
            if pos_change > 0.003 or rot_change > 0.3:  # Even lower thresholds for smoother display
                return True
        return False

    def update_history(self, markers):
        all_ids = set(markers.keys()) | set(self.last_states.keys())
        
        for marker_id in all_ids:
            marker_id_str = str(marker_id)
            if marker_id_str not in self.design_history:
                self.design_history[marker_id_str] = {}
            
            data = markers.get(marker_id, self.last_states.get(marker_id, {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': {'x': 0, 'y': 0, 'z': 0}
            }))
            
            config = self.config['markers'].get(marker_id_str, self.config['default'])
            
            entry = {
                **config,
                "pos-rot": {
                    "x": data['position']['x'], "y": data['position']['y'], "z": data['position']['z'],
                    "rx": data['rotation']['x'], "ry": data['rotation']['y'], "rz": data['rotation']['z'],
                    "s": 0.1
                }
            }
            
            self.design_history[marker_id_str][str(self.frame_count)] = entry
        
        self.frame_count += 1

    def calculate_fps(self):
        self.fps_counter += 1
        if self.fps_counter % 30 == 0:  # Every 30 frames
            current_time = time.time()
            elapsed = current_time - self.fps_start_time
            fps = 30 / elapsed
            print(f"📊 Processing FPS: {fps:.1f} | Frames: {self.frame_count} | Clients: {len(self.clients)}")
            self.fps_start_time = current_time

    def export_history(self, filename=None):
        if not filename:
            filename = f"design_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        try:
            with open(filename, 'w') as f:
                json.dump(self.design_history, f, indent=2)
            print(f"✅ Exported: {filename} ({self.frame_count} frames)")
        except Exception as e:
            print(f"❌ Export error: {e}")

    async def handle_client(self, websocket, path=None):
        self.clients.add(websocket)
        print(f"🔗 Client connected. Total: {len(self.clients)}")
        try:
            await websocket.wait_closed()
        finally:
            self.clients.remove(websocket)
            print(f"❌ Client disconnected. Total: {len(self.clients)}")

    async def broadcast(self, data):
        if self.clients:
            message = json.dumps(data)
            disconnected = []
            for client in self.clients:
                try:
                    await client.send(message)
                except:
                    disconnected.append(client)
            
            # Clean up disconnected clients
            for client in disconnected:
                self.clients.discard(client)

    async def main_loop(self):
        print("🚀 Starting optimized tracker...")
        print("Press Ctrl+C to stop and export")
        
        # Start worker threads
        self.running = True
        capture_thread = threading.Thread(target=self.capture_thread, daemon=True)
        process_thread = threading.Thread(target=self.process_thread, daemon=True)
        
        capture_thread.start()
        process_thread.start()
        
        try:
            while self.running:
                try:
                    # Get latest processing result
                    result = self.result_queue.get(timeout=0.05)  # Shorter timeout for responsiveness
                    markers = result['markers']
                    
                    # Apply prediction for smoother movement
                    predicted_markers = self.predict_marker_positions(markers)
                    
                    # Update history less frequently
                    if self.should_update_history(markers):
                        self.update_history(markers)
                    
                    # Broadcast predicted positions for smoother display
                    if self.should_broadcast(predicted_markers):
                        await self.broadcast({
                            'type': 'tracking_update',
                            'markers': predicted_markers,
                            'timestamp': time.time(),
                            'processing_time': result['processing_time'],
                            'predicted': True
                        })
                        self.last_states = markers.copy()  # Store actual, not predicted
                    
                    self.calculate_fps()
                    
                except Empty:
                    continue
                except KeyboardInterrupt:
                    break
                
                await asyncio.sleep(0.001)  # Minimal delay
                
        except KeyboardInterrupt:
            pass
        finally:
            print("\n🛑 Shutting down...")
            self.running = False
            self.export_history()
            self.cap.release()

    async def start(self, host='localhost', port=8765):
        server = await websockets.serve(self.handle_client, host, port)
        print(f"🌐 WebSocket server running on ws://{host}:{port}")
        await self.main_loop()

if __name__ == "__main__":
    tracker = OptimizedTracker()
    try:
        asyncio.run(tracker.start())
    except KeyboardInterrupt:
        print("\n✅ Tracker stopped")