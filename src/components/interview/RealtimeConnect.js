// interview-frontend/src/components/RealtimeConnect.js
import React, { useEffect, useState, useRef, useReducer } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import AudioVisualizer from "./AudioVisualizer";
import styles from "./realtimeconnect.module.css";
import Transcription from './Transcription';

function connectionReducer(state, action) {
  switch (action.type) {
    case 'SET_CONNECTING':
      return { ...state, isConnecting: action.payload };
    case 'SET_CALL_ACTIVE':
      return { ...state, callActive: action.payload };
    case 'SET_CONNECTION_STATE':
      return { ...state, connectionState: action.payload };
    case 'SET_NETWORK_QUALITY':
      return { ...state, networkQuality: action.payload };
    case 'ADD_TRANSCRIPT':
      return { ...state, transcripts: [...state.transcripts, action.payload] };
    case 'SET_NOTIFICATION':
      return { ...state, notification: action.payload };
    case 'SET_MUTED':
      return { ...state, isMuted: action.payload };
    case 'SET_CALL_DURATION':
      return { ...state, callDuration: action.payload };
    case 'SET_CALL_START_TIME':
      return { ...state, callStartTime: action.payload };
    default:
      return state;
  }
}

function RealtimeConnect() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [log, setLog] = useState("");
  
  // Replace multiple state variables with useReducer
  const [state, dispatch] = useReducer(connectionReducer, {
    isConnecting: false,
    callActive: false,
    connectionState: 'new',
    networkQuality: 'unknown',
    isMuted: false,
    callStartTime: null,
    callDuration: 0,
    transcripts: [],
    notification: {
      show: false,
      message: '',
      type: 'info'
    }
  });
  
  const [callInfo, setCallInfo] = useState({
    title: "Loading...",
    host: "Loading...",
    price: "$5.00 call"
  });
  
  // Keep your refs as they are
  const remoteMediaStreamRef = useRef(new MediaStream());
  const audioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef(null);
  
  // Reference for reconnection attempts
  const iceRestartAttemptsRef = useRef(0);
  const maxIceRestarts = 3;
  const iceRestartTimeoutRef = useRef(null);

  // Add notification timeout ref
  const notificationTimeoutRef = useRef(null);
  
  // Add duration interval ref
  const durationIntervalRef = useRef(null);

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
        let jitter = 0;
        
        stats.forEach(stat => {
          // Look for inbound-rtp stats to check packet loss
          if (stat.type === 'inbound-rtp' && stat.packetsLost !== undefined) {
            totalPacketsLost += stat.packetsLost;
            totalPackets += stat.packetsReceived;
            if (stat.jitter !== undefined) {
              jitter = Math.max(jitter, stat.jitter);
            }
          }
          
          // Look for remote-inbound-rtp for RTT (Round Trip Time)
          if (stat.type === 'remote-inbound-rtp' && stat.roundTripTime !== undefined) {
            currentRtt = stat.roundTripTime;
          }
        });
        
        // Calculate packet loss percentage
        const packetLossPercent = totalPackets > 0 ? (totalPacketsLost / totalPackets) * 100 : 0;
        
        // Determine connection quality with more granular thresholds
        let quality = 'excellent';
        if (packetLossPercent > 10 || currentRtt > 0.3 || jitter > 0.05) {
          quality = 'poor';
        } else if (packetLossPercent > 5 || currentRtt > 0.15 || jitter > 0.03) {
          quality = 'fair';
        } else if (packetLossPercent > 1 || currentRtt > 0.05 || jitter > 0.01) {
          quality = 'good';
        }
        
        dispatch({ type: 'SET_NETWORK_QUALITY', payload: quality });
        
        // Log connection stats for debugging
        appendLog(`Connection quality: ${quality} (loss: ${packetLossPercent.toFixed(1)}%, RTT: ${(currentRtt * 1000).toFixed(0)}ms, jitter: ${(jitter * 1000).toFixed(1)}ms)`);
        
        // If quality is poor, consider proactive measures
        if (quality === 'poor' && state.callActive) {
          showNotification("Connection quality is poor. Consider switching to a more stable network.", "warning", 10000);
        }
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
      dispatch({ type: 'SET_CONNECTING', payload: false });
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
    
    // Cleanup function - IMPORTANT: Don't navigate in the cleanup function
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
      
      // Reset all state
      dispatch({ type: 'SET_CONNECTION_STATE', payload: 'closed' });
      dispatch({ type: 'SET_CALL_ACTIVE', payload: false });
      dispatch({ type: 'SET_CONNECTING', payload: false });
      dispatch({ type: 'SET_NETWORK_QUALITY', payload: 'unknown' });
      dispatch({ type: 'SET_MUTED', payload: false });
      
      appendLog("Call ended - all resources cleaned up");
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

  // Update showNotification helper function to use dispatch
  const showNotification = (message, type = 'info', duration = 5000) => {
    // Clear any existing timeout
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }

    dispatch({
      type: 'SET_NOTIFICATION',
      payload: {
        show: true,
        message,
        type
      }
    });

    // Auto-hide notification after duration
    notificationTimeoutRef.current = setTimeout(() => {
      dispatch({
        type: 'SET_NOTIFICATION',
        payload: { ...state.notification, show: false }
      });
    }, duration);
  };

  // Create an axios instance with default config
  const api = axios.create({
    baseURL: 'https://demobackend-p2e1.onrender.com',
    timeout: 10000, // 10 seconds timeout
    headers: {
      'Content-Type': 'application/json'
    }
  });

  // Add request interceptor to include auth token
  api.interceptors.request.use(config => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  }, error => {
    return Promise.reject(error);
  });

  // Helper function for OpenAI API requests
  const openaiApi = async (url, method, data, headers = {}) => {
    try {
      const response = await axios({
        url: `https://api.openai.com/v1${url}`,
        method,
        data,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 15000 // 15 seconds timeout for OpenAI
      });
      return response.data;
    } catch (error) {
      // Enhanced error handling
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`OpenAI API error: ${error.response.status} - ${error.response.data?.error?.message || error.response.statusText}`);
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error(`OpenAI API request timeout: ${error.message}`);
      } else {
        // Something happened in setting up the request
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    }
  };

  // Update performIceRestart to use axios
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
      
      // Wait for ICE gathering with timeout and better error handling
      await Promise.race([
        new Promise((resolve, reject) => {
          const checkState = () => {
            if (!peerConnectionRef.current) {
              reject(new Error("PeerConnection was closed during ICE gathering"));
              return;
            }
            
            if (peerConnectionRef.current.iceGatheringState === "complete") {
              peerConnectionRef.current.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          
          if (peerConnectionRef.current.iceGatheringState === "complete") {
            resolve();
          } else {
            peerConnectionRef.current.addEventListener("icegatheringstatechange", checkState);
          }
        }),
        new Promise(resolve => setTimeout(() => {
          appendLog("ICE gathering timed out, continuing with available candidates");
          resolve();
        }, 5000))
      ]);

      // Get new ephemeral token using axios
      try {
        const rtResp = await api.get(`/realtime/token?session_id=${sessionId}`);
        const ephemeralKey = rtResp.data.client_secret.value;

        // Use axios for OpenAI API call with retry logic
        let retries = 0;
        const maxRetries = 3;
        let answerSDP;
        
        while (retries < maxRetries) {
          try {
            // Use axios for the OpenAI API call
            const response = await axios({
              url: 'https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp'
              },
              data: offer.sdp,
              timeout: 10000
            });
            
            answerSDP = response.data;
            break;
          } catch (error) {
            if (error.response && (error.response.status === 429 || error.response.status >= 500) && retries < maxRetries - 1) {
              retries++;
              const backoff = Math.pow(2, retries) * 1000;
              appendLog(`API call failed with status ${error.response.status}. Retrying in ${backoff/1000}s...`);
              await new Promise(r => setTimeout(r, backoff));
            } else {
              throw error;
            }
          }
        }

        await peerConnectionRef.current.setRemoteDescription({ type: "answer", sdp: answerSDP });
        
        appendLog("ICE restart completed successfully");
        iceRestartAttemptsRef.current = 0; // Reset counter on success
        
        // Update connection state
        dispatch({ type: 'SET_CONNECTION_STATE', payload: 'checking' });
        
      } catch (error) {
        throw new Error(`Failed to get token or set remote description: ${error.message}`);
      }
      
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

  // Update handleConnect to use axios
  async function handleConnect() {
    // Reset connection state if reconnecting
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    dispatch({ type: 'SET_CONNECTING', payload: true });
    appendLog("Starting connection process...");

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
      // Get Twilio TURN credentials using axios
      appendLog("Fetching TURN credentials...");
      const turnResp = await api.get('/webrtc/turn-credentials');
      const turnData = turnResp.data;
      appendLog(`Got TURN credentials (TTL: ${turnData.ttl}s)`);

      // Get ephemeral token using axios
      appendLog("Fetching ephemeral token...");
      const rtResp = await api.get(`/realtime/token?session_id=${sessionId}`);
      const ephemeralKey = rtResp.data.client_secret.value;
      appendLog("Got ephemeral key: " + ephemeralKey.substring(0, 15) + "...");

      // 2) Create RTCPeerConnection with improved configuration
      appendLog("Creating RTCPeerConnection...");
      const configuration = {
        iceServers: [
          // Prioritize Twilio TURN servers first since they're showing good performance
          ...turnData.iceServers,
          { urls: "stun:stun.l.google.com:19302" },
          // Google STUN servers as fallback
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" },
          
          // OpenRelay as last resort fallback
          { urls: "stun:openrelay.metered.ca:80" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        rtcpMuxPolicy: 'require',
        bundlePolicy: 'max-bundle',
        sdpSemantics: 'unified-plan'
      };

      // Store the peer connection in the ref
      const pc = new RTCPeerConnection(configuration);
      peerConnectionRef.current = pc;

      // Set up connection state change handler with improved state management
      pc.onconnectionstatechange = () => {
        appendLog(`Connection state changed: ${pc.connectionState}`);
        dispatch({ type: 'SET_CONNECTION_STATE', payload: pc.connectionState });
        
        if (pc.connectionState === 'connected') {
          dispatch({ type: 'SET_CALL_ACTIVE', payload: true });
          dispatch({ type: 'SET_CONNECTING', payload: false });
          reconnectAttemptsRef.current = 0;
          
          // Start tracking call duration
          const startTime = Date.now();
          dispatch({ type: 'SET_CALL_START_TIME', payload: startTime });
          durationIntervalRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            dispatch({ type: 'SET_CALL_DURATION', payload: elapsed });
          }, 1000);
          
          // Start monitoring connection quality
          monitorConnectionQuality(pc);
          iceRestartAttemptsRef.current = 0; // Reset ICE restart counter
        } else if (pc.connectionState === 'disconnected') {
          // Try ICE restart first before full reconnection
          performIceRestart();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          dispatch({ type: 'SET_CALL_ACTIVE', payload: false });
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
          dispatch({ type: 'SET_CONNECTION_STATE', payload: 'checking' });
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
            remoteMediaStreamRef.current = evt.streams[0];
            
            // Set up audio playback
            const audioEl = audioRef.current;
            if (audioEl) {
              audioEl.srcObject = evt.streams[0];
              audioEl.play().catch(error => {
                appendLog(`Audio play error: ${error.message}`);
              });
            }
            
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

      // TRICKLE ICE IMPLEMENTATION:
      // Instead of waiting for ICE gathering to complete, we'll send the offer immediately
      // and then update with candidates as they arrive
      
      // Create a function to send the initial offer with any candidates we already have
      const sendInitialOffer = async () => {
        appendLog("Sending initial SDP offer to OpenAI Realtime API...");
        
        // Get the current SDP (which might have some candidates already)
        const currentSdp = pc.localDescription.sdp;
        
        try {
          // Use axios for the OpenAI API call
          const response = await axios({
            url: 'https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ephemeralKey}`,
              'Content-Type': 'application/sdp'
            },
            data: currentSdp,
            timeout: 10000
          });
          
          const answerSDP = response.data;
          appendLog("Received SDP answer from OpenAI.");
          
          // Set the remote description
          await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
          appendLog("Remote SDP set.");
          appendLog("Setup complete - waiting for audio...");
        } catch (error) {
          let errorMessage = "Unknown error";
          
          if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            errorMessage = `API returned status ${error.response.status}: ${error.response.data?.error?.message || error.response.statusText}`;
          } else if (error.request) {
            // The request was made but no response was received
            errorMessage = `Request timeout: ${error.message}`;
          } else {
            // Something happened in setting up the request
            errorMessage = error.message;
          }
          
          appendLog(`Error sending initial offer: ${errorMessage}`);
          throw new Error(errorMessage);
        }
      };
      
      // Send the initial offer after a short delay to allow some candidates to gather
      // This is a compromise between waiting for all candidates and sending immediately
      setTimeout(() => {
        sendInitialOffer().catch(err => {
          appendLog(`Failed to send initial offer: ${err.message}`);
          showNotification(`Connection error: ${err.message}`, "error");
          dispatch({ type: 'SET_CONNECTING', payload: false });
        });
      }, 500); // 500ms delay to collect some initial candidates

    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      console.error("Connection error:", err);
      // Replace alert with notification
      showNotification(`Connection error: ${err.message}`, "error");
      dispatch({ type: 'SET_CONNECTING', payload: false });
      
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
    dispatch({ type: 'SET_CONNECTION_STATE', payload: 'closed' });
    dispatch({ type: 'SET_CALL_ACTIVE', payload: false });
    dispatch({ type: 'SET_CONNECTING', payload: false });
    dispatch({ type: 'SET_NETWORK_QUALITY', payload: 'unknown' });
    dispatch({ type: 'SET_MUTED', payload: false });
    
    // Calculate final duration
    const finalDuration = state.callStartTime ? Math.floor((Date.now() - state.callStartTime) / 1000) : 0;
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

  // Update handleMuteToggle to use dispatch
  const handleMuteToggle = () => {
    if (!localStreamRef.current) return;
    
    // Toggle mute state
    const newMuteState = !state.isMuted;
    dispatch({ type: 'SET_MUTED', payload: newMuteState });
    
    // Actually mute/unmute the audio tracks
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = newMuteState; // If currently muted, enable tracks
    });
    
    appendLog(`Microphone ${newMuteState ? 'unmuted' : 'muted'}`);
  };

  // Add a function to handle new transcripts from the Transcription component
  const handleTranscriptReceived = (transcript) => {
    dispatch({
      type: 'ADD_TRANSCRIPT',
      payload: transcript
    });
  };

  return (
    <div className={styles.container}>
      {/* Update notification component to use state from reducer */}
      {state.notification.show && (
        <div className={`${styles.notification} ${styles[state.notification.type]}`}>
          <div className={styles.notificationContent}>
            {state.notification.message}
          </div>
          <button 
            className={styles.notificationClose}
            onClick={() => dispatch({ 
              type: 'SET_NOTIFICATION', 
              payload: { ...state.notification, show: false }
            })}
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
          style={{ backgroundColor: getConnectionStateColor(state.connectionState) }}
        ></div>
        <span className={styles.statusText}>
          {getConnectionStatusText(state.connectionState)}
        </span>
      </div>
      
      {/* Call header */}
      <div className={styles.callHeader}>
        <div className={styles.callPrice}>{callInfo.price}</div>
        <div className={styles.callTitle}>{callInfo.title}</div>
        <div className={styles.callHost}>{callInfo.host}</div>
      </div>
      
      {/* Visualizer area - wrap with React.lazy and Suspense in a real implementation */}
      <div className={styles.visualizerContainer}>
        <AudioVisualizer 
          mediaStream={remoteMediaStreamRef.current} 
          isLoading={state.isConnecting}
        />
      </div>
      
      {/* Call controls */}
      <div className={styles.controlsContainer}>
        <button 
          className={`${styles.controlButton} ${styles.micButton} ${state.isMuted ? styles.muted : ''}`}
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
      
      {/* Debug log */}
      {process.env.NODE_ENV === 'development' && 
       (process.env.REACT_APP_SHOW_DEBUG_LOGS === 'true' || process.env.REACT_APP_SHOW_DEBUG_LOGS === '"true"') && (
        <div className={styles.debugLogContainer}>
          <pre className={styles.debugLog}>
            === DEBUG LOG ===
            {log || 'Waiting for logs...'}
          </pre>
        </div>
      )}
      
      {/* Replace the transcript panel with the new component */}
      <Transcription 
        transcripts={state.transcripts}
        remoteMediaStream={remoteMediaStreamRef.current}
        localStream={localStreamRef.current}
        isCallActive={state.callActive}
        onTranscriptReceived={handleTranscriptReceived}
      />

      {/* Footer */}
      <footer className={styles.footer}>
        <a href="mailto:maxricodecastro@gmail.com">Need help?</a>
        <a href="https://www.use-reach.com" target="_blank" rel="noopener noreferrer">About Reach</a>
      </footer>
    </div>
  );
}

export default RealtimeConnect;
