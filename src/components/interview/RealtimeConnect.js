// interview-frontend/src/components/RealtimeConnect.js
import React, { useEffect, useState, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import AudioVisualizer from "./AudioVisualizer";
import styles from "./realtimeconnect.module.css";

function RealtimeConnect() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [log, setLog] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callInfo, setCallInfo] = useState({
    title: "Loading...",
    host: "Loading...",
    price: "$5.00 call"
  });
  
  // Reference to the remote MediaStream for AI audio
  const remoteMediaStreamRef = useRef(new MediaStream());
  // Reference for the audio element
  const audioRef = useRef(null);
  // Reference to store the RTCPeerConnection
  const peerConnectionRef = useRef(null);
  // Reference to store local stream
  const localStreamRef = useRef(null);
  // Reference for reconnection attempts
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [networkQuality, setNetworkQuality] = useState('unknown');
  const [callStartTime, setCallStartTime] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const durationIntervalRef = useRef(null);

  // Set call info from navigation state
  useEffect(() => {
    if (location.state) {
      setCallInfo({
        title: location.state.title,
        host: location.state.host,
        price: `$${location.state.price} call`
      });
    }
  }, [location.state]);

  useEffect(() => {
    console.log('Debug environment:', {
      NODE_ENV: process.env.NODE_ENV,
      SHOW_DEBUG_LOGS: process.env.REACT_APP_SHOW_DEBUG_LOGS
    });
  }, []);

  useEffect(() => {
    appendLog("Debug logging initialized...");
  }, []);

  function appendLog(msg) {
    console.log("Log:", msg);
    setLog((prev) => prev + "\n" + msg);
  }

  // Function to monitor and analyze connection quality
  const monitorConnectionQuality = (pc) => {
    if (!pc) return;
    
    // Get connection stats every 3 seconds
    const statsInterval = setInterval(async () => {
      if (pc.connectionState !== 'connected') {
        clearInterval(statsInterval);
        return;
      }
      
      try {
        const stats = await pc.getStats();
        let totalPacketsLost = 0;
        let totalPackets = 0;
        let currentRtt = 0;
        
        stats.forEach(stat => {
          // Look for inbound-rtp stats to check packet loss
          if (stat.type === 'inbound-rtp' && stat.packetsLost !== undefined) {
            totalPacketsLost += stat.packetsLost;
            totalPackets += stat.packetsReceived;
          }
          
          // Look for remote-inbound-rtp for RTT (Round Trip Time)
          if (stat.type === 'remote-inbound-rtp' && stat.roundTripTime !== undefined) {
            currentRtt = stat.roundTripTime;
          }
        });
        
        // Calculate packet loss percentage
        const packetLossPercent = totalPackets > 0 ? (totalPacketsLost / totalPackets) * 100 : 0;
        
        // Determine connection quality
        let quality = 'excellent';
        if (packetLossPercent > 10 || currentRtt > 0.3) {
          quality = 'poor';
        } else if (packetLossPercent > 3 || currentRtt > 0.15) {
          quality = 'fair';
        } else if (packetLossPercent > 1 || currentRtt > 0.05) {
          quality = 'good';
        }
        
        setNetworkQuality(quality);
        
        // Log connection stats for debugging
        appendLog(`Connection quality: ${quality} (loss: ${packetLossPercent.toFixed(1)}%, RTT: ${(currentRtt * 1000).toFixed(0)}ms)`);
      } catch (err) {
        console.error("Error getting connection stats:", err);
      }
    }, 3000);
    
    return () => clearInterval(statsInterval);
  };

  // Function to handle reconnection
  const attemptReconnect = async () => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      appendLog("Maximum reconnection attempts reached. Please try again later.");
      setIsConnecting(false);
      return;
    }
    
    reconnectAttemptsRef.current++;
    appendLog(`Reconnection attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}...`);
    
    try {
      await handleConnect();
    } catch (err) {
      appendLog(`Reconnection failed: ${err.message}`);
      
      // Exponential backoff for retry
      const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
      appendLog(`Retrying in ${backoffTime/1000} seconds...`);
      
      reconnectTimeoutRef.current = setTimeout(attemptReconnect, backoffTime);
    }
  };

  useEffect(() => {
    // Auto-connect when component mounts if we have a sessionId
    if (sessionId) {
      // Reset connection state before attempting to connect
      reconnectAttemptsRef.current = 0;
      
      // Small delay to ensure component is fully mounted
      setTimeout(() => {
        handleConnect();
      }, 100);
    }
    
    // Cleanup function
    return () => {
      // Close peer connection if it exists
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      // Stop local stream tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      
      // Clear any reconnection timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [sessionId]);

  // Function to get color for connection state
  const getConnectionStateColor = (state) => {
    switch (state) {
      case 'connected': return '#4ade80'; // Green
      case 'connecting': return '#facc15'; // Yellow
      case 'checking': return '#facc15'; // Yellow
      case 'disconnected': return '#f97316'; // Orange
      case 'failed': return '#ef4444'; // Red
      case 'closed': return '#ef4444'; // Red
      default: return '#a3a3a3'; // Gray for new/unknown
    }
  };

  // Function to get human-readable status text
  const getConnectionStatusText = (state) => {
    switch (state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting';
      case 'checking': return 'Checking';
      case 'disconnected': return 'Disconnected';
      case 'failed': return 'Failed';
      case 'closed': return 'Closed';
      default: return 'Initializing';
    }
  };

  async function handleConnect() {
    // Reset connection state if reconnecting
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    setIsConnecting(true);
    appendLog("Starting connection process...");

    // 0) Get JWT token from localStorage.
    const jwtToken = localStorage.getItem("token");
    if (!jwtToken) return alert("You must be logged in first.");
    if (!sessionId) return alert("Need a session ID.");

    try {
      // Get Twilio TURN credentials first
      appendLog("Fetching TURN credentials...");
      const turnResp = await fetch('https://demobackend-p2e1.onrender.com/webrtc/turn-credentials', {
        headers: { Authorization: `Bearer ${jwtToken}` }
      });
      if (!turnResp.ok) throw new Error("Failed to get TURN credentials");
      const turnData = await turnResp.json();
      appendLog(`Got TURN credentials (TTL: ${turnData.ttl}s)`);

      // 1) Get ephemeral token from your backend.
      appendLog("Fetching ephemeral token...");
      const rtResp = await fetch(`https://demobackend-p2e1.onrender.com/realtime/token?session_id=${sessionId}`, {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });
      if (!rtResp.ok) throw new Error("Failed to get ephemeral token");
      const rtData = await rtResp.json();
      const ephemeralKey = rtData.client_secret.value;
      appendLog("Got ephemeral key: " + ephemeralKey.substring(0, 15) + "...");

      // 2) Create RTCPeerConnection with Twilio credentials
      appendLog("Creating RTCPeerConnection...");
      const pc = new RTCPeerConnection({
        iceServers: [
          // Google STUN servers as fallback
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          
          // Add Twilio's ICE servers
          ...turnData.iceServers,
          
          // OpenRelay as last resort fallback
          { urls: "stun:openrelay.metered.ca:80" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        rtcpMuxPolicy: 'require',
        bundlePolicy: 'max-bundle',
        sdpSemantics: 'unified-plan'
      });

      // Store the peer connection in the ref
      peerConnectionRef.current = pc;

      // Set up connection state change handler
      pc.onconnectionstatechange = () => {
        appendLog(`Connection state changed: ${pc.connectionState}`);
        setConnectionState(pc.connectionState);
        
        if (pc.connectionState === 'connected') {
          setCallActive(true);
          setIsConnecting(false);
          reconnectAttemptsRef.current = 0;
          
          // Start tracking call duration
          const startTime = Date.now();
          setCallStartTime(startTime);
          durationIntervalRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            setCallDuration(elapsed);
          }, 1000);
          
          // Start monitoring connection quality
          monitorConnectionQuality(pc);
        } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
          setCallActive(false);
          
          // Clear duration interval
          if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
          }
          
          // Attempt reconnection for disconnected or failed states
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            attemptReconnect();
          }
        }
      };

      // Set up ICE connection state change handler
      pc.oniceconnectionstatechange = () => {
        appendLog(`ICE connection state changed: ${pc.iceConnectionState}`);
        // Update connection state based on ICE state as well
        if (pc.iceConnectionState === 'checking') {
          setConnectionState('checking');
        }
      };
      
      pc.onicegatheringstatechange = () => {
        appendLog(`ICE gathering state: ${pc.iceGatheringState}`);
      };
      
      pc.onsignalingstatechange = () => {
        appendLog(`Signaling state: ${pc.signalingState}`);
      };
      
      // Log ICE candidates for debugging
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateInfo = {
            protocol: event.candidate.protocol,
            type: event.candidate.type,
            address: event.candidate.address,
            server: event.candidate.relatedAddress ? 'TURN' : 'STUN',
            url: event.candidate.url,
            relatedAddress: event.candidate.relatedAddress,
            relatedPort: event.candidate.relatedPort,
            raw: event.candidate.candidate
          };
          
          appendLog(`ICE candidate: ${JSON.stringify(candidateInfo, null, 2)}`);
          console.log('ICE Candidate Details:', candidateInfo);
        }
      };

      // 3) Add the user's microphone audio.
      appendLog("Adding user audio track...");
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        
        // Store the local stream in the ref
        localStreamRef.current = localStream;
        
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      } catch (mediaError) {
        appendLog(`Media error: ${mediaError.message}`);
        throw new Error(`Could not access microphone: ${mediaError.message}`);
      }

      // 4) Set up ontrack handler to play incoming audio.
      pc.ontrack = (evt) => {
        appendLog("🎵 Track received: " + evt.track.kind);
        if (evt.track.kind === "audio") {
          try {
            // Store the AI audio stream in the ref for the visualizer
            remoteMediaStreamRef.current = evt.streams[0];
            
            const audioEl = audioRef.current;
            if (!audioEl) {
              appendLog(" Audio element not found!");
              return;
            }
            
            // Set the stream to the audio element
            audioEl.srcObject = evt.streams[0];
            audioEl.volume = 1.0;
            
            // Handle audio playback errors
            audioEl.onerror = (e) => {
              appendLog(`Audio playback error: ${e}`);
            };
            
            audioEl.play().catch(playError => {
              appendLog(`Audio play error: ${playError.message}`);
              // Try again with user interaction
              appendLog("Audio playback requires user interaction. Please click anywhere on the page.");
            });
          } catch (audioError) {
            appendLog(`Audio setup error: ${audioError.message}`);
          }
        }
      };

      // 5) Create a local SDP offer.
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        voiceActivityDetection: true
      });
      appendLog("Local SDP offer created.");
      await pc.setLocalDescription(offer);

      // 6) Wait for ICE gathering to complete or timeout
      appendLog("Waiting for ICE gathering to complete...");
      await Promise.race([
        new Promise(resolve => {
          if (pc.iceGatheringState === "complete") {
            resolve();
          } else {
            const checkState = () => {
              if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", checkState);
                resolve();
              }
            };
            pc.addEventListener("icegatheringstatechange", checkState);
          }
        }),
        // Add a timeout to prevent waiting indefinitely
        new Promise(resolve => {
          setTimeout(() => {
            // Continue anyway after timeout, just log it
            appendLog("ICE gathering timed out, continuing with available candidates");
            resolve();
          }, 5000); // 5 second timeout
        })
      ]);
      appendLog("ICE gathering complete or timed out.");

      // 7) Send the SDP offer to the OpenAI Realtime API.
      appendLog("Sending SDP offer to OpenAI Realtime API...");
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      
      // Add retry logic for API call
      let retries = 0;
      const maxRetries = 3;
      let sdpResp;
      
      while (retries < maxRetries) {
        try {
          sdpResp = await fetch(`${baseUrl}?model=${model}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ephemeralKey}`,
              "Content-Type": "application/sdp",
            },
            body: offer.sdp,
          });
          
          if (sdpResp.ok) break;
          
          // If we get a 429 or 500+ error, retry
          if (sdpResp.status === 429 || sdpResp.status >= 500) {
            retries++;
            const backoff = Math.pow(2, retries) * 1000; // Exponential backoff
            appendLog(`API call failed with status ${sdpResp.status}. Retrying in ${backoff/1000}s...`);
            await new Promise(r => setTimeout(r, backoff));
          } else {
            // For other errors, don't retry
            throw new Error(`API returned status ${sdpResp.status}`);
          }
        } catch (fetchError) {
          retries++;
          if (retries >= maxRetries) throw fetchError;
          
          const backoff = Math.pow(2, retries) * 1000;
          appendLog(`API call failed: ${fetchError.message}. Retrying in ${backoff/1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
      
      if (!sdpResp.ok) throw new Error("OpenAI Realtime handshake failed after retries");
      
      const answerSDP = await sdpResp.text();
      appendLog("Received SDP answer from OpenAI.");

      // 8) Set the remote SDP.
      await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
      appendLog("Remote SDP set.");
      appendLog("Setup complete - waiting for audio...");
    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      console.error("Connection error:", err);
      alert("Connection error: " + err.message);
      setIsConnecting(false);
      
      // If this was an initial connection attempt, try reconnecting
      if (reconnectAttemptsRef.current === 0) {
        attemptReconnect();
      }
    }
  }

  const handleEndCall = () => {
    appendLog("Ending call...");
    
    // Clear duration interval
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    
    // Close the peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Stop all local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // Reset connection state
    setConnectionState('closed');
    setCallActive(false);
    setIsConnecting(false);
    
    // Calculate final duration
    const finalDuration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    
    // Format duration for display
    const minutes = Math.floor(finalDuration / 60);
    const seconds = finalDuration % 60;
    const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Navigate to summary page with duration
    navigate('/summary', { 
      state: { 
        duration: formattedDuration
      }
    });
  };

  const handleMuteToggle = () => {
    if (!localStreamRef.current) return;
    
    // Toggle mute state
    setIsMuted(!isMuted);
    
    // Actually mute/unmute the audio tracks
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = isMuted; // If currently muted, enable tracks
    });
    
    appendLog(`Microphone ${isMuted ? 'unmuted' : 'muted'}`);
  };

  return (
    <div className={styles.container}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        id="aiAudio"
        autoPlay
        style={{ display: "none" }}
      />
      
      {/* Connection status indicator */}
      <div className={styles.connectionIndicator}>
        <div 
          className={styles.statusDot}
          style={{ backgroundColor: getConnectionStateColor(connectionState) }}
        ></div>
        <span className={styles.statusText}>
          {getConnectionStatusText(connectionState)}
        </span>
      </div>
      
      {/* Call header */}
      <div className={styles.callHeader}>
        <div className={styles.callPrice}>{callInfo.price}</div>
        <div className={styles.callTitle}>{callInfo.title}</div>
        <div className={styles.callHost}>{callInfo.host}</div>
      </div>
      
      {/* Visualizer area */}
      <div className={styles.visualizerContainer}>
        <AudioVisualizer 
          mediaStream={remoteMediaStreamRef.current} 
          isLoading={isConnecting}
        />
      </div>
      
      {/* Call controls */}
      <div className={styles.controlsContainer}>
        <button 
          className={`${styles.controlButton} ${styles.micButton} ${isMuted ? styles.muted : ''}`}
          onClick={handleMuteToggle}
        >
          <img src="/assets/mute.svg" alt="Mute" />
        </button>
        <button className={`${styles.controlButton} ${styles.optionsButton}`}>
          <img src="/assets/dots.svg" alt="Options" />
        </button>
        <button 
          className={`${styles.controlButton} ${styles.endCallButton}`}
          onClick={handleEndCall}
        >
          <img src="/assets/x.svg" alt="End Call" />
        </button>
      </div>
      
      {/* Debug log - modified condition and added test content */}
      {process.env.NODE_ENV === 'development' && 
       (process.env.REACT_APP_SHOW_DEBUG_LOGS === 'true' || process.env.REACT_APP_SHOW_DEBUG_LOGS === '"true"') && (
        <div className={styles.debugLogContainer}>
          <pre className={styles.debugLog}>
            === DEBUG LOG ===
            {log || 'Waiting for logs...'}
          </pre>
        </div>
      )}
    </div>
  );
}

export default RealtimeConnect;
