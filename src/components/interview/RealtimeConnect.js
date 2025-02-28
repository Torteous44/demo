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

  // Add new state for tracking ICE restart attempts
  const iceRestartAttemptsRef = useRef(0);
  const maxIceRestarts = 3;
  const iceRestartTimeoutRef = useRef(null);

  // Add new state for notifications
  const [notification, setNotification] = useState({
    show: false,
    message: '',
    type: 'info' // 'info', 'error', 'warning', 'success'
  });

  // Add notification timeout ref
  const notificationTimeoutRef = useRef(null);

  // Add new state and refs for transcription
  const [transcripts, setTranscripts] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const assemblyWsRef = useRef(null);

  // Add new ref for AI WebSocket and audio context
  const aiAssemblyWsRef = useRef(null);
  const aiAudioContextRef = useRef(null);
  const aiProcessorRef = useRef(null);

  // Add new state for tracking AI transcription
  const [isAiTranscribing, setIsAiTranscribing] = useState(false);

  // Add ref for user WebSocket
  const userAssemblyWsRef = useRef(null);
  const userAudioContextRef = useRef(null);
  const userProcessorRef = useRef(null);

  // Add state for user transcription
  const [isUserTranscribing, setIsUserTranscribing] = useState(false);

  // Add a new ref to track the last transcript
  const lastTranscriptRef = useRef({
    text: '',
    speaker: '',
    timestamp: ''
  });

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
      appendLog("Component unmounting - cleaning up resources...");
      
      // Clear all intervals and timeouts
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (iceRestartTimeoutRef.current) {
        clearTimeout(iceRestartTimeoutRef.current);
        iceRestartTimeoutRef.current = null;
      }
      
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
        notificationTimeoutRef.current = null;
      }
      
      // Clean up peer connection
      if (peerConnectionRef.current) {
        // Remove all event listeners
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.oniceconnectionstatechange = null;
        peerConnectionRef.current.onicegatheringstatechange = null;
        peerConnectionRef.current.onsignalingstatechange = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        
        // Close all data channels if any
        peerConnectionRef.current.getDataChannels?.().forEach(channel => channel.close());
        
        // Close the connection
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      // Clean up audio element
      if (audioRef.current) {
        audioRef.current.srcObject = null;
        audioRef.current.load();
      }
      
      // Clean up media streams
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
        localStreamRef.current = null;
      }
      
      if (remoteMediaStreamRef.current) {
        remoteMediaStreamRef.current.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
        remoteMediaStreamRef.current = new MediaStream();
      }
      
      // Clean up transcription
      if (assemblyWsRef.current) {
        assemblyWsRef.current.close();
        assemblyWsRef.current = null;
      }
      
      // Clean up AI transcription resources
      if (aiAssemblyWsRef.current) {
        aiAssemblyWsRef.current.close();
        aiAssemblyWsRef.current = null;
      }
      
      if (aiProcessorRef.current) {
        aiProcessorRef.current.disconnect();
        aiProcessorRef.current = null;
      }
      
      if (aiAudioContextRef.current) {
        aiAudioContextRef.current.close();
        aiAudioContextRef.current = null;
      }
      
      // Clean up user transcription resources
      if (userAssemblyWsRef.current) {
        userAssemblyWsRef.current.close();
        userAssemblyWsRef.current = null;
      }
      
      if (userProcessorRef.current) {
        userProcessorRef.current.disconnect();
        userProcessorRef.current = null;
      }
      
      if (userAudioContextRef.current) {
        userAudioContextRef.current.close();
        userAudioContextRef.current = null;
      }
      
      setIsAiTranscribing(false);
      setIsUserTranscribing(false);
      
      appendLog("Cleanup complete");
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

  // Add showNotification helper function
  const showNotification = (message, type = 'info', duration = 5000) => {
    // Clear any existing timeout
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }

    setNotification({
      show: true,
      message,
      type
    });

    // Auto-hide notification after duration
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, duration);
  };

  // Add the AI transcription initialization function
  const initializeAiTranscription = async () => {
    try {
      appendLog("Initializing AI transcription...");
      
      // Get temporary token
      const jwtToken = localStorage.getItem("token");
      const response = await fetch('https://demobackend-p2e1.onrender.com/transcription/assembly-token', {
        headers: { 
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get AI token: ${await response.text()}`);
      }
      
      const { token: aiTempToken } = await response.json();
      const SAMPLE_RATE = 16000;
      const wsUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${SAMPLE_RATE}&token=${encodeURIComponent(aiTempToken)}`;
      
      const aiWs = new WebSocket(wsUrl);
      aiAssemblyWsRef.current = aiWs;

      aiWs.onopen = () => {
        appendLog("AI WebSocket connected");
        setIsAiTranscribing(true);
        
        // Set up audio processing once WebSocket is open
        if (remoteMediaStreamRef.current) {
          aiAudioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
          const source = aiAudioContextRef.current.createMediaStreamSource(remoteMediaStreamRef.current);
          const processor = aiAudioContextRef.current.createScriptProcessor(2048, 1, 1);
          aiProcessorRef.current = processor;
          
          processor.onaudioprocess = (e) => {
            if (aiWs.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16Data = convertFloat32ToInt16(inputData);
              aiWs.send(int16Data);
            }
          };
          
          source.connect(processor);
          processor.connect(aiAudioContextRef.current.destination);
          appendLog("AI audio processing pipeline established");
        }
      };

      aiWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.message_type === 'FinalTranscript') {
            // Check if this is a duplicate of the last transcript
            if (lastTranscriptRef.current.text === message.text && 
                lastTranscriptRef.current.speaker === 'AI') {
              return; // Skip duplicate transcript
            }
            
            // Update last transcript
            lastTranscriptRef.current = {
              text: message.text,
              speaker: 'AI',
              timestamp: new Date().toISOString()
            };

            setTranscripts(prev => [
              ...prev,
              {
                text: message.text,
                speaker: 'AI',
                timestamp: new Date().toISOString()
              }
            ]);
          }
        } catch (error) {
          appendLog(`Error processing AI message: ${error.message}`);
        }
      };

      aiWs.onerror = (error) => {
        appendLog(`AI WebSocket error: ${error.message || 'Unknown error'}`);
        showNotification("AI transcription error occurred", "error");
      };

      aiWs.onclose = () => {
        setIsAiTranscribing(false);
        appendLog("AI WebSocket closed");
      };

    } catch (error) {
      appendLog(`Failed to initialize AI transcription: ${error.message}`);
      showNotification(`AI transcription unavailable: ${error.message}`, "error");
    }
  };

  // Add user transcription initialization function
  const initializeUserTranscription = async () => {
    try {
      appendLog("Initializing user transcription...");
      
      // Get temporary token
      const jwtToken = localStorage.getItem("token");
      const response = await fetch('https://demobackend-p2e1.onrender.com/transcription/assembly-token', {
        headers: { 
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get user token: ${await response.text()}`);
      }
      
      const { token: userTempToken } = await response.json();
      const SAMPLE_RATE = 16000;
      const wsUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${SAMPLE_RATE}&token=${encodeURIComponent(userTempToken)}`;
      
      const userWs = new WebSocket(wsUrl);
      userAssemblyWsRef.current = userWs;

      userWs.onopen = () => {
        appendLog("User WebSocket connected");
        setIsUserTranscribing(true);
        
        // Set up audio processing once WebSocket is open
        if (localStreamRef.current) {
          userAudioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
          const source = userAudioContextRef.current.createMediaStreamSource(localStreamRef.current);
          const processor = userAudioContextRef.current.createScriptProcessor(2048, 1, 1);
          userProcessorRef.current = processor;
          
          processor.onaudioprocess = (e) => {
            if (userWs.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16Data = convertFloat32ToInt16(inputData);
              userWs.send(int16Data);
            }
          };
          
          source.connect(processor);
          processor.connect(userAudioContextRef.current.destination);
          appendLog("User audio processing pipeline established");
        }
      };

      userWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.message_type === 'FinalTranscript') {
            // Check if this is a duplicate of the last transcript
            if (lastTranscriptRef.current.text === message.text && 
                lastTranscriptRef.current.speaker === 'User') {
              return; // Skip duplicate transcript
            }
            
            // Update last transcript
            lastTranscriptRef.current = {
              text: message.text,
              speaker: 'User',
              timestamp: new Date().toISOString()
            };

            setTranscripts(prev => [
              ...prev,
              {
                text: message.text,
                speaker: 'User',
                timestamp: new Date().toISOString()
              }
            ]);
          }
        } catch (error) {
          appendLog(`Error processing user message: ${error.message}`);
        }
      };

      userWs.onerror = (error) => {
        appendLog(`User WebSocket error: ${error.message || 'Unknown error'}`);
        showNotification("User transcription error occurred", "error");
      };

      userWs.onclose = () => {
        setIsUserTranscribing(false);
        appendLog("User WebSocket closed");
      };

    } catch (error) {
      appendLog(`Failed to initialize user transcription: ${error.message}`);
      showNotification(`User transcription unavailable: ${error.message}`, "error");
    }
  };

  // Update handleConnect to initialize transcription after WebRTC connection
  async function handleConnect() {
    // Reset connection state if reconnecting
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    setIsConnecting(true);
    appendLog("Starting connection process...");

    // Replace alert with notification
    const jwtToken = localStorage.getItem("token");
    if (!jwtToken) {
      showNotification("Please log in to continue", "error");
      return;
    }
    if (!sessionId) {
      showNotification("Invalid session", "error");
      return;
    }

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
      const configuration = {
        iceServers: [
          // Prioritize Twilio TURN servers first since they're showing good performance
          ...turnData.iceServers,
          { urls: "stun:stun.l.google.com:19302" },
          // Google STUN servers as fallback
          { urls: "stun:stun1.l.google.com:19302" },
          
          // OpenRelay as last resort fallback
          { urls: "stun:openrelay.metered.ca:80" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all', // Could consider 'relay' if NAT traversal is problematic
        rtcpMuxPolicy: 'require',
        bundlePolicy: 'max-bundle',
        sdpSemantics: 'unified-plan'
      };

      // Store the peer connection in the ref
      const pc = new RTCPeerConnection(configuration);
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
          iceRestartAttemptsRef.current = 0; // Reset ICE restart counter
        } else if (pc.connectionState === 'disconnected') {
          // Try ICE restart first before full reconnection
          performIceRestart();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setCallActive(false);
          if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
          }
          // For failed state, attempt full reconnection
          if (pc.connectionState === 'failed') {
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

        // Initialize user transcription once we have the local stream
        initializeUserTranscription();

      } catch (mediaError) {
        appendLog(`Media error: ${mediaError.message}`);
        throw new Error(`Could not access microphone: ${mediaError.message}`);
      }

      // 4) Set up ontrack handler to play incoming audio.
      pc.ontrack = (evt) => {
        appendLog("🎵 Track received: " + evt.track.kind);
        if (evt.track.kind === "audio") {
          try {
            remoteMediaStreamRef.current = evt.streams[0];
            
            // Set up audio playback
            const audioEl = audioRef.current;
            if (audioEl) {
              audioEl.srcObject = evt.streams[0];
              audioEl.play().catch(error => {
                appendLog(`Audio play error: ${error.message}`);
              });
            }
            
            // Initialize AI transcription once we have the remote stream
            initializeAiTranscription();
            
          } catch (error) {
            appendLog(`Audio setup error: ${error.message}`);
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
      const model = "gpt-4o-mini-realtime-preview";
      
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
      // Replace alert with notification
      showNotification(`Connection error: ${err.message}`, "error");
      setIsConnecting(false);
      
      if (reconnectAttemptsRef.current === 0) {
        attemptReconnect();
      }
    }
  }

  const handleEndCall = () => {
    appendLog("Ending call - cleaning up resources...");
    
    // Clear all intervals and timeouts
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (iceRestartTimeoutRef.current) {
      clearTimeout(iceRestartTimeoutRef.current);
      iceRestartTimeoutRef.current = null;
    }
    
    // Clean up peer connection
    if (peerConnectionRef.current) {
      // Remove all event listeners
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.onicegatheringstatechange = null;
      peerConnectionRef.current.onsignalingstatechange = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      
      // Close all data channels if any
      peerConnectionRef.current.getDataChannels?.().forEach(channel => channel.close());
      
      // Close the connection
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Clean up audio element
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.load(); // Reset the audio element
    }
    
    // Clean up media streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      localStreamRef.current = null;
    }
    
    if (remoteMediaStreamRef.current) {
      remoteMediaStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      remoteMediaStreamRef.current = new MediaStream();
    }
    
    // Reset all state
    setConnectionState('closed');
    setCallActive(false);
    setIsConnecting(false);
    setNetworkQuality('unknown');
    setIsMuted(false);
    
    // Calculate final duration
    const finalDuration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const minutes = Math.floor(finalDuration / 60);
    const seconds = finalDuration % 60;
    const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    appendLog("Call ended - all resources cleaned up");
    
    // Navigate to summary page
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

  // Function to handle ICE restart
  const performIceRestart = async () => {
    if (!peerConnectionRef.current || iceRestartAttemptsRef.current >= maxIceRestarts) {
      appendLog("Cannot perform ICE restart - falling back to full reconnection");
      attemptReconnect();
      return;
    }

    try {
      appendLog(`Attempting ICE restart (attempt ${iceRestartAttemptsRef.current + 1}/${maxIceRestarts})`);
      iceRestartAttemptsRef.current++;

      // Create new offer with iceRestart: true
      const offer = await peerConnectionRef.current.createOffer({ 
        iceRestart: true,
        offerToReceiveAudio: true,
        voiceActivityDetection: true
      });
      
      await peerConnectionRef.current.setLocalDescription(offer);
      
      // Wait for ICE gathering with timeout
      await Promise.race([
        new Promise(resolve => {
          const checkState = () => {
            if (peerConnectionRef.current.iceGatheringState === "complete") {
              peerConnectionRef.current.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          peerConnectionRef.current.addEventListener("icegatheringstatechange", checkState);
        }),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);

      // Get new ephemeral token and send offer to OpenAI
      const jwtToken = localStorage.getItem("token");
      const rtResp = await fetch(`https://demobackend-p2e1.onrender.com/realtime/token?session_id=${sessionId}`, {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });
      const rtData = await rtResp.json();
      const ephemeralKey = rtData.client_secret.value;

      const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpResp.ok) throw new Error("Failed to get SDP answer during ICE restart");

      const answerSDP = await sdpResp.text();
      await peerConnectionRef.current.setRemoteDescription({ type: "answer", sdp: answerSDP });
      
      appendLog("ICE restart completed successfully");
      iceRestartAttemptsRef.current = 0; // Reset counter on success
    } catch (err) {
      appendLog(`ICE restart failed: ${err.message}`);
      // If ICE restart fails, try again with exponential backoff or fall back to full reconnect
      const backoffTime = Math.min(1000 * Math.pow(2, iceRestartAttemptsRef.current), 5000);
      
      if (iceRestartAttemptsRef.current < maxIceRestarts) {
        appendLog(`Retrying ICE restart in ${backoffTime/1000}s...`);
        iceRestartTimeoutRef.current = setTimeout(performIceRestart, backoffTime);
      } else {
        appendLog("Maximum ICE restarts attempted, falling back to full reconnection");
        attemptReconnect();
      }
    }
  };

  // Add helper function for audio conversion
  function convertFloat32ToInt16(buffer) {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf.buffer;
  }

  return (
    <div className={styles.container}>
      {/* Add notification component */}
      {notification.show && (
        <div className={`${styles.notification} ${styles[notification.type]}`}>
          <div className={styles.notificationContent}>
            {notification.message}
          </div>
          <button 
            className={styles.notificationClose}
            onClick={() => setNotification(prev => ({ ...prev, show: false }))}
          >
            ×
          </button>
        </div>
      )}

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
      
      {/* Updated transcript panel */}
      <div className={styles.transcriptPanel}>
        <div className={styles.transcriptHeader}>
          <span>Transcript:</span>
          <img src="/assets/chat.svg" alt="Transcript" width="20" height="20" />
        </div>
        <div className={styles.transcriptContent}>
          {transcripts.map((transcript, index) => (
            <div key={index} className={styles.transcriptEntry}>
              <span className={styles.timestamp}>
                {new Date(transcript.timestamp).toLocaleTimeString([], { 
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit'
                })}:
              </span>
              <span className={`${styles.transcriptText} ${
                transcript.speaker === 'AI' ? styles.aiText : styles.userText
              }`}>
                "{transcript.text}"
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add footer */}
      <footer className={styles.footer}>
        <a href="mailto:maxricodecastro@gmail.com">Need help?</a>
        <a href="https://www.use-reach.com" target="_blank" rel="noopener noreferrer">About Reach</a>
      </footer>
    </div>
  );
}

export default RealtimeConnect;
