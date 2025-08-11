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
        
        # Try different resolutions for speed vs accuracy
        resolutions = [(320, 240), (424, 240), (640, 480)]
        for width, height in resolutions:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            actual_w = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            actual_h = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            if actual_w == width and actual_h == height:
                print(f"📷 Resolution set: {width}x{height}")
                break
        
        # FPS optimization
        self.cap.set(cv2.CAP_PROP_FPS, 90)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Reduce buffer to minimize lag
        actual_fps = self.cap.get(cv2.CAP_PROP_FPS)
        print(f"🎯 Target FPS: 90, Actual: {actual_fps}")
        
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
        self.frame_queue = Queue(maxsize=2)  # Small queue to prevent lag buildup
        self.result_queue = Queue(maxsize=10)
        self.running = False
        
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
        """Dedicated thread for frame capture"""
        print("🎬 Capture thread started")
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                continue
                
            # Drop old frames if queue is full
            if self.frame_queue.full():
                try:
                    self.frame_queue.get_nowait()
                except Empty:
                    pass
            
            try:
                self.frame_queue.put_nowait((time.time(), frame))
            except:
                pass  # Queue full, drop frame
            
            time.sleep(0.005)  # Small delay to prevent overwhelming

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
                        # Fast rotation conversion
                        R, _ = cv2.Rodrigues(rvec.flatten())
                        markers[int(marker_id)] = {
                            'id': int(marker_id),
                            'position': {
                                'x': float(tvec[0]), 
                                'y': float(tvec[1]), 
                                'z': float(tvec[2])
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
            
            if pos_change > 0.005 or rot_change > 0.5:  # Lower thresholds for smooth display
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
            filename = f"design_histories/{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
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
                    result = self.result_queue.get(timeout=0.1)
                    markers = result['markers']
                    
                    # Update history less frequently
                    if self.should_update_history(markers):
                        self.update_history(markers)
                    
                    # Broadcast more frequently for smooth display
                    if self.should_broadcast(markers):
                        await self.broadcast({
                            'type': 'tracking_update',
                            'markers': markers,
                            'timestamp': time.time(),
                            'processing_time': result['processing_time']
                        })
                        self.last_states = markers.copy()
                    
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